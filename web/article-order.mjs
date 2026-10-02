// Keep the user's article identifiers (including gaps) while ordering exports.
export function articlesByNumber(articles){
  const number=a=>Number.isSafeInteger(Number(a.articleNo))&&Number(a.articleNo)>0?Number(a.articleNo):Infinity;
  return [...articles].sort((a,b)=>number(a)-number(b));
}
