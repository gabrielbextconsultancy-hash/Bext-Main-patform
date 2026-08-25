require('dotenv').config();
const {Pool}=require('pg');
(async()=>{
 const db=new Pool({host:process.env.PG_HOST,port:+process.env.PG_PORT,database:process.env.PG_DB,user:process.env.PG_USER,password:process.env.PG_PASSWORD});
 // Only attempts since this file was armed, so a stale run cannot look like a pass.
 const since = process.env.SINCE_TS;
 const f=await db.query(`SELECT s.slug, fa.tier, fa.outcome, fa.articles_found AS n
   FROM fetch_attempts fa JOIN sources s ON s.id=fa.source_id
   WHERE s.method='sitemap' AND fa.run_at > $1::timestamptz
   ORDER BY fa.run_at DESC, s.slug, fa.tier`,[since]);
 if(f.rowCount){
   const a=await db.query(`SELECT s.slug, count(*) AS n FROM articles a JOIN sources s ON s.id=a.source_id
     WHERE s.method='sitemap' GROUP BY 1 ORDER BY 1`);
   console.log('NEW ingest run completed:');
   f.rows.filter(r=>r.tier===1).forEach(r=>console.log('   tier1 '+r.outcome+'  found='+r.n+'  '+r.slug));
   console.log('  articles now stored from sitemap sources:');
   if(!a.rowCount) console.log('     none');
   a.rows.forEach(r=>console.log('     '+String(r.n).padStart(3)+'  '+r.slug));
 }
 await db.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
