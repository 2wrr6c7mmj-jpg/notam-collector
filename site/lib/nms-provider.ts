import {
  hasPathContext,
  parseNotice,
  resolveReferencedGeometry,
  sourceGeometry,
  sanitizePoints,
  type Notice,
  type Point,
  type Shape,
} from "./notam";

type GeoGeometry = {
  type?: string;
  coordinates?: unknown;
  geometries?: GeoGeometry[];
} | null;
type GeoFeature = {
  properties?: {
    coreNOTAMData?: {
      notam?: Record<string, unknown>;
      notamTranslation?: Array<Record<string, unknown>>;
    };
  };
  geometry?: GeoGeometry;
};

function point(value: unknown): Point | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
    ? [lat, lon]
    : null;
}

function line(value: unknown): Point[] {
  return sanitizePoints(
    Array.isArray(value)
      ? value.map(point).filter((p): p is Point => Boolean(p))
      : [],
  );
}

function path(points: Point[], _text: string): Shape[] {
  return points.length ? [{kind:points.length>1?"line":"point",points}] : [];
}

function geometryShapes(geometry: GeoGeometry, text: string): Shape[] {
  if (!geometry) return [];
  if (geometry.type === "GeometryCollection")
    return (geometry.geometries || []).flatMap((item) =>
      geometryShapes(item, text),
    );
  if (geometry.type === "Point") {
    const p = point(geometry.coordinates);
    return p ? [{ kind: "point", points: [p] }] : [];
  }
  if (geometry.type === "MultiPoint")
    return line(geometry.coordinates).map((p) => ({
      kind: "point",
      points: [p],
    }));
  if (geometry.type === "LineString") {
    const points = line(geometry.coordinates);
    return path(points, text);
  }
  if (geometry.type === "MultiLineString") {
    return Array.isArray(geometry.coordinates)
      ? geometry.coordinates
          .map(line)
          .filter((points) => points.length)
          .flatMap((points) => path(points, text))
      : [];
  }
  if (geometry.type === "Polygon") {
    const ring = Array.isArray(geometry.coordinates)
      ? line(geometry.coordinates[0])
      : [];
    return ring.length >= 3 ? [{ kind: "polygon", points: ring, holes: Array.isArray(geometry.coordinates) ? geometry.coordinates.slice(1).map(line).filter(points=>points.length>=3) : [] }] : [];
  }
  if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates)) return [];
    return geometry.coordinates.flatMap(polygon=>{
      if(!Array.isArray(polygon))return [];
      const points=line(polygon[0]);
      return points.length>=3?[{kind:"polygon" as const,points,holes:polygon.slice(1).map(line).filter(ring=>ring.length>=3)}]:[];
    });
  }
  return [];
}

export function featureToNotice(feature: GeoFeature): Notice | null {
  const core = feature.properties?.coreNOTAMData;
  const notam = core?.notam || {};
  const translations = core?.notamTranslation || [];
  const icao = translations.find((item) => item.type === "ICAO");
  const local = translations.find((item) => item.type === "LOCAL_FORMAT");
  const text = String(
    icao?.formattedText || local?.simpleText || notam.text || "",
  ).trim();
  if (!text) return null;
  const parsed = parseNotice(text);
  const geoShapes = geometryShapes(feature.geometry || null, text).map(shape=>({...shape,provenance:"provider" as const}));
  if(!parsed.shapes.some(shape=>!shape.approx)) for(const shape of geoShapes) if(shape.kind === "point") shape.approx=true;
  const shapes = sourceGeometry(parsed, geoShapes);
  const radius = Number(notam.radius);
  const qSubject = text.toUpperCase().match(/Q\)\s*[A-Z]{4}\/Q([A-Z]{2})[A-Z]{2}\//)?.[1] || "";
  if (
    !shapes.some((shape) => shape.kind !== "point") &&
    !parsed.shapes.some((shape) => !shape.approx) &&
    /^[RW]/.test(qSubject) &&
    Number.isFinite(radius) &&
    radius > 0 &&
    radius < 900
  ) {
    const center = shapes.find((shape) => shape.kind === "point")?.points[0];
    if (center)
      shapes.push({ kind: "circle", points: [center], radius: radius * 1852, approx: true });
  }
  const series = String(notam.series || "");
  const number = String(notam.number || "");
  const id =
    parsed.id !== "番号不明"
      ? parsed.id
      : [series, number].filter(Boolean).join(" ") ||
        String(notam.id || "番号不明");
  const location = String(
    notam.icaoLocation ||
      notam.location ||
      notam.affectedFir ||
      parsed.location ||
      "",
  );
  const date = (value: unknown) => {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  return {
    ...parsed,
    id,
    location,
    issued: date(notam.issued),
    start: date(notam.effectiveStart) ?? parsed.start,
    end: date(notam.effectiveEnd) ?? parsed.end,
    permanent:
      parsed.permanent ||
      String(notam.effectiveEnd || "").toUpperCase() === "PERM",
    shapes: shapes.length ? shapes : parsed.shapes,
    warnings: shapes.length
      ? parsed.warnings.filter((warning) => warning !== "描画可能な座標なし" && (!warning.startsWith("帯状区域の中心線") || shapes.some((shape) => shape.kind === "line")))
      : parsed.warnings,
  };
}

export type NmsEnv = { DB: D1Database; NMS_RELAY_URL?: string; NMS_RELAY_SECRET?: string; NOTAM_UPDATE_TOKEN?: string; NOTAM_CRON_TOKEN_SHA256?: string };
function providerError(value: unknown) {
  // Classify diagnostics without exposing their text or embedded credentials.
  const message = typeof value === "string" ? value.replace(/[_-]/g, " ") : "";
  if (/not allowed|not permitted|unsupported|not supported|allowlist|whitelist|対象外|未登録|許可され/i.test(message)) return "この地点はFAA中継サービスの取得対象に登録されていません。";
  if (/quota|too many|rate limit|429|割り当て|呼び出し回数|上限/i.test(message)) return "FAA中継サービスの利用上限に達しました。次の更新で再試行します。";
  if (/unauthorized|authentication|invalid secret|forbidden|401|403|認証|資格情報/i.test(message)) return "FAA中継サービスの認証またはアクセス許可を確認する必要があります。";
  return "FAA中継サービスが取得エラーを返しました。";
}
export async function fetchNotams(env: NmsEnv, code: string, fetcher: typeof fetch = fetch) {
  if (!env.NMS_RELAY_URL || !env.NMS_RELAY_SECRET) throw new Error("FAA中継サービスが設定されていません。");
  const response = await fetcher(env.NMS_RELAY_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ codes: [code], relaySecret: env.NMS_RELAY_SECRET }),
    redirect: "follow", signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`FAA中継サービス HTTP ${response.status}`);
  // Provider diagnostics can contain credentials; return only bounded summaries.
  const relay = await response.json() as { error?: string; errors?: string[]; features?: GeoFeature[]; fetchedAt?: number };
  if (relay.error) throw new Error(providerError(relay.error));
  if (relay.errors?.length) throw new Error(`FAAの応答に取得エラーが含まれます（${relay.errors.length}件）。`);
  if (!Array.isArray(relay.features)) throw new Error("FAAの応答形式を確認できません。");
  const items = relay.features.map(featureToNotice).filter((item): item is Notice => Boolean(item));
  if (relay.features.length && !items.length) throw new Error("FAAの応答からNOTAM本文を読み取れません。");
  return { items: resolveReferencedGeometry([...new Map(items.map((item) => [`${item.location}|${item.id}|${item.text}`, item])).values()]),
    fetchedAt: Number.isFinite(relay.fetchedAt) && relay.fetchedAt! > 0 && relay.fetchedAt! <= Date.now() + 60000 ? relay.fetchedAt! : Date.now() };
}
