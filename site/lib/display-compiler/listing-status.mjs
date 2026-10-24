// This is current-source status only. It never supplies an activity interval.
export function listingStatus(notice,now=Date.now()){
 const s=notice?.sourceListing;
 if(notice?.cancelled||notice?.staticSchedule?.cancelled||s?.kind!=='source-listing'||s?.activityPeriod!=='absent-in-reviewed-original'||!Number.isFinite(now)||!Number.isFinite(s.seenAt))return null;
 return !s.refreshFailed&&s.seenAt<=now&&now-s.seenAt<2*3600000?'掲載中':'保存分・要更新';
}
export function maritimeStatusLabel(notice,now=Date.now()){
 const listing=listingStatus(notice,now);if(listing)return listing;
 if(!notice?.msilIdentity)return null;
 if(notice.cancelled||notice.staticSchedule?.cancelled)return '取消済み';
 if(notice.staticSchedule?.timeBasis==='validity-fallback')return '期間';
 if(notice.staticSchedule?.periodKnowledge==='primary-and-conditional')return '主日程あり・予備日要確認';
 if(notice.staticSchedule?.openEndedPeriods?.length)return '終了未定';
 if(notice.staticSchedule?.periods?.length)return notice.staticSchedule.completeness==='partial'?'一部日程あり':'日程あり';
 if(notice.sourceSchedule?.excerpts?.length)return '日程あり';
 return null;
}
