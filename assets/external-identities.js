/**
 * Provider identities are real, independently reconcilable identities.
 * Synthetic keys never masquerade as a Git author email, and adding one to a
 * contributor group does not manufacture a Git commit.
 */
import { autoMatchGithubPublishers } from './impact.js?v=git-ingest-input-20261113-1';

const emailPattern=/^[^\s@<>]{1,100}@[^\s@<>]{1,120}$/;
export const herokuIdentity=email=>`heroku:${String(email||'').trim().toLowerCase()}`;
export const githubIdentity=login=>`github:${String(login||'').trim().toLowerCase()}`;

export function externalIdentities(github=[],heroku=[]) {
  const result=new Map();
  for(const release of github){
    if(release?.draft||!release?.publisher)continue;
    const login=String(release.publisher).trim().toLowerCase();
    if(!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login))continue;
    const key=githubIdentity(login),item=result.get(key)||{key,name:`@${login}`,kind:'GitHub publisher',events:0,commits:0,aliases:[login]};
    item.events++;result.set(key,item);
  }
  for(const release of heroku){
    const email=String(release?.actorEmail||'').trim().toLowerCase();
    if(!emailPattern.test(email))continue;
    const key=herokuIdentity(email),item=result.get(key)||{key,name:email,kind:'Heroku release actor',events:0,commits:0,aliases:[email]};
    item.events++;result.set(key,item);
  }
  return result;
}

/**
 * Attach exact/uniquely resolved provider identities to existing groups and
 * leave genuinely unknown accounts as visible, mergeable singleton groups.
 * Existing manual group placement always wins (including session restores).
 */
export function reconcileProviderGroups(groups,external,github=[],commits=[]) {
  const result=groups.map(g=>({...g,emails:[...g.emails]}));
  const claimed=new Set(result.flatMap(g=>g.emails));
  // Only match against original Git emails; external aliases should not be
  // used as weaker evidence to infer a completely different account.
  const gitGroups=result.map((g,i)=>({id:String(i),displayName:g.displayName,
    emails:g.emails.filter(email=>!email.startsWith('github:')&&!email.startsWith('heroku:'))}));
  const githubMatches=autoMatchGithubPublishers(github,gitGroups,commits);
  const emailToGroup=new Map(gitGroups.flatMap((g,i)=>g.emails.map(e=>[e,i])));
  for(const [key,identity] of external){
    if(claimed.has(key))continue;
    let to=-1;
    if(key.startsWith('heroku:')){
      to=emailToGroup.get(key.slice(7))??-1;
    }else if(key.startsWith('github:')){
      const match=githubMatches.get(key.slice(7));
      if(match?.group)to=Number(match.group.id);
    }
    if(to>=0&&to<result.length)result[to].emails.push(key);
    else result.push({displayName:identity.name,emails:[key]});
    claimed.add(key);
  }
  return result;
}

/**
 * An incremental import must never undo names, linked identities, working-day
 * schedules or ordering chosen by the user. Known keys stay put. New Git
 * emails are kept separate (guessing by display name would be destructive);
 * provider identities are attached only when their exact/unique match is safe.
 */
export function extendContributorGroups(groups,catalogue,github=[],heroku=[],commits=[]) {
  const result=groups.map(group=>({...group,emails:[...group.emails]}));
  const known=new Set(result.flatMap(group=>group.emails));
  const added=[];
  for(const [email,meta] of catalogue) {
    if(known.has(email) || email.startsWith('github:') || email.startsWith('heroku:'))continue;
    result.push({displayName:meta.name || email,emails:[email]});
    known.add(email);added.push(email);
  }
  const withProviders=reconcileProviderGroups(result,externalIdentities(github,heroku),github,commits);
  for(const group of withProviders)for(const key of group.emails)if(!known.has(key)){
    known.add(key);added.push(key);
  }
  return {groups:withProviders,added};
}
