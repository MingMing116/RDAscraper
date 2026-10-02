// Preserve user selection and edits while retrying incomplete article bodies.
import {verifyArticle,pool} from './news.mjs';

export function needsBodyRecovery(article){
  return !article.bodyUserEdited&&(!article.body?.trim()||article.bodyLimited||!article.checked||article.linkMismatch);
}

export async function recoverArticleBody(article,{token,signal,verify=verifyArticle}={}){
  if(article.bodyUserEdited)return {...article};
  const next=await verify(article,token,signal,{refresh:true});
  if(signal?.aborted)throw new DOMException('본문 확인을 중단했습니다.','AbortError');
  const useful=Boolean(next.checked&&!next.linkMismatch&&next.body?.trim());
  if(!useful){
    return {...article,checked:false,bodyLimited:true,
      fetchNote:next.fetchNote||'본문을 다시 확보하지 못했습니다. 원문에서 확인하거나 본문을 직접 보완하세요.'};
  }
  // A restored project must reverify its source, but a shorter restricted
  // preview must never erase previously saved article text.
  if(next.bodyLimited&&article.body?.trim()&&next.body.trim().length<article.body.trim().length){
    return {...article,checked:false,bodyLimited:true,
      fetchNote:'이번 재확인에서는 본문 일부만 확보하여 이전에 저장한 본문을 유지했습니다. 원문 대조가 필요합니다.'};
  }
  const keep=article.userEdited?{title:article.title,media:article.media,date:article.date,dateSource:article.dateSource}:{};
  return {...article,...next,...keep,included:article.included,articleNo:article.articleNo,id:article.id,
    bodyUserEdited:false,fetchNote:next.bodyLimited?(next.fetchNote||'본문 일부만 확보했습니다.'):(next.fetchNote||'')};
}

export async function prepareArticleBodies(articles,{token,signal,onProgress=()=>{},verify=verifyArticle}={}){
  const result=articles.map(a=>({...a})),pending=result.map((a,i)=>({a,i})).filter(x=>needsBodyRecovery(x.a));
  let done=0,recovered=0;
  onProgress(0,pending.length);
  await pool(pending,2,async({a,i})=>{
    try{
      result[i]=await recoverArticleBody(a,{token,signal,verify});
      if(result[i].checked&&!result[i].bodyLimited&&result[i].body)recovered++;
    }catch(e){if(e.name==='AbortError')throw e;result[i]={...a,checked:false,bodyLimited:true,fetchNote:e.message||'본문 확인 실패'};}
    onProgress(++done,pending.length);
  },signal);
  if(signal?.aborted)throw new DOMException('본문 확인을 중단했습니다.','AbortError');
  return {articles:result,attempted:pending.length,recovered,
    unavailable:result.filter(a=>!a.body?.trim()).length,partial:result.filter(a=>a.body?.trim()&&a.bodyLimited).length};
}
