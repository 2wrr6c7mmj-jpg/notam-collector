# NOTAM Collector

[NOTAM Watch](https://notam-watch.pages.dev/) のデータ取得処理です。航空NOTAM（FAA NMS-API）と、各国・地域の公開航行警告を2時間ごとに取得し、公開JSONとして出力します。

ChatGPT Sites上で動いていた取得処理（`site/lib/`）を変更せずにそのまま使い、実行環境だけをGitHub Actionsに移しています。

## 仕組み

| 項目 | 内容 |
| --- | --- |
| 実行 | GitHub Actions、2時間ごと（日本時間の奇数時35分） |
| 航空 | FAA NMS-APIへ自分の認証情報で直接接続（Cloudflare経由ではFAAに接続できないため） |
| 海上 | 中国海事局・韓国・台湾・フィリピン・海上保安庁などの公開ページ |
| 保存 | SQLite（Sitesと同じD1の表定義）。取得に失敗した発表元は前回の成功分を保持 |
| 出力 | `data` ブランチの `public/api/nms.json`・`nav-warnings.json`・`update.json`（Sitesの同名APIと同じ形式） |

`data` ブランチは毎回1コミットで上書きします。

## 初期設定

GitHubのこのリポジトリで **Settings → Secrets and variables → Actions → New repository secret** から、次の2つを登録します。値はFAAから届いた認証情報ファイルにあります。

| 名前 | 値 |
| --- | --- |
| `FAA_NMS_CLIENT_ID` | NMS-APIのClient ID |
| `FAA_NMS_CLIENT_SECRET` | NMS-APIのClient Secret |

登録後、**Actions → Collect NOTAM and navigational warnings → Run workflow** で初回を実行できます。

## 台湾の射撃通報の区域と期間

台湾漁業署の射撃通報は、区域と期間が添付の PDF・ODT にだけ書かれています。収集のあと、まだ読んでいない通報（新着と、添付が差し替わったもの）の添付を取得し、区域と期間を読み取って台帳に加えます（`taiwan-notice/`）。

| 項目 | 内容 |
| --- | --- |
| 台帳 | `data` ブランチの `public/api/tw-firing-ledger.json`。通報ごとに題名・掲載日・区域・期間・読んだ添付の番号と SHA-256。`taiwan-notice/ledger-seed.json` は開始時点の台帳 |
| 取得 | 1 回に通報 4 件まで、1 リクエストごとに 3.5 秒あける。robots.txt を確かめ、403・429 が出たらその回は止める |
| 読み取り | PDF の文字は pypdf、画像だけの PDF は tesseract（繁体字・英語）で 2 通りに読み、同じ区域が 2 回読めたものか、ほかの通報で確定している区域と合うものだけを採る |
| 添付と本文 | 実行中の一時ディレクトリだけに置き、保存も公開もしません（担当者の氏名・電話番号が入るため）。収集本体（`site/lib/nav-tw-fisheries.ts`）は通報のページだけを読み、添付は取得しません |
| 失敗したとき | 収集の公開は止めず、台帳は前回のまま出します。取得できなかった通報は次回もう一度試します |

## 安全性

- 認証情報はGitHub Secretsだけに置き、コード・ログ・出力には含めません。
- 取得失敗は0件として扱わず、前回の成功データと取得日時を保持します。
- FAAへの問い合わせは、Sites版と同じく2地点ずつ・2.1秒間隔です。3組連続で失敗したらFAAへの問い合わせを止めます。

## 開発

```sh
npm install
npm test
npm run collect -- --db state/notam.sqlite --out public --codes RJJJ --sources ln
```

Node.js 22.13以上が必要です（`node:sqlite` とTypeScriptの直接実行を使います）。
