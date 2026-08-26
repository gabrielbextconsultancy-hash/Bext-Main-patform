require('dotenv').config();
const {Pool}=require('pg');
(async()=>{
 const db=new Pool({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DB,user:process.env.PG_USER,password:process.env.PG_PASSWORD});
 const f=await db.query(`SELECT s.slug, fa.tier, fa.outcome, fa.articles_found AS n, fa.detail
   FROM fetch_attempts fa JOIN sources s ON s.id=fa.source_id
   WHERE s.slug IN ('vic-premier','aer-registers') AND fa.run_at > $1::timestamptz
     AND (fa.detail IS NULL OR fa.detail NOT LIKE 'outside the firecrawl%')
   ORDER BY fa.run_at DESC, fa.tier LIMIT 10`,[process.env.SINCE_TS]);
 const hit=f.rows.filter(r=>r.outcome==='success'||r.detail===null&&r.outcome!=='skipped');
 if(f.rows.some(r=>r.outcome==='success')||f.rows.some(r=>r.tier===2&&r.outcome!=='skipped')){
  console.log('FIRECRAWL RUN RESULT:');
  f.rows.forEach(x=>console.log('  tier'+x.tier+' '+x.outcome.padEnd(8)+'found='+String(x.n).padStart(3)+'  '+x.slug+'  '+(x.detail||'').slice(0,50)));
  const a=await db.query(`SELECT s.slug, count(*) AS n FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE s.slug IN ('vic-premier','aer-registers') AND a.fetched_at > $1::timestamptz GROUP BY 1`,[process.env.SINCE_TS]);
  a.rows.forEach(x=>console.log('  NEW ARTICLES: '+x.n+'  '+x.slug));
 }
 await db.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
