const { chromium, devices } = require("playwright");
const BASE="http://localhost:3100", SHOTS=__dirname+"/shots";
const res=[]; let cur="";
const ok=(n,c,x="")=>{res.push({env:cur,name:n,pass:!!c,extra:x});console.log(`${c?"PASS":"FAIL"} [${cur}] ${n}${x?" — "+x:""}`)};
const session=()=>{const s={access_token:"fake-access.fake.fake",token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:"r",user:{id:"11111111-1111-4111-8111-111111111111",aud:"authenticated",role:"authenticated",email:"tester@example.test",app_metadata:{},user_metadata:{},created_at:"2026-01-01T00:00:00Z"}};return "base64-"+Buffer.from(JSON.stringify(s)).toString("base64url")};
(async()=>{
 const b=await chromium.launch();
 for(const [label,dev] of [["PC",null],["iPhone 13","iPhone 13"]]){
  cur=label;
  const ctx=await b.newContext(dev?{...devices[dev]}:{viewport:{width:1280,height:900}});
  await ctx.addCookies([{name:"sb-127-auth-token",value:session(),domain:"localhost",path:"/"}]);
  const p=await ctx.newPage();
  await p.goto(BASE+"/stylist/diagnosis"); await p.waitForSelector("h1");
  const n=await p.locator("main .space-y-3 button[aria-pressed]").count();
  const txt=await p.locator("main").innerText();
  ok("入口無効: 1問目は4択",n===4,String(n));
  ok("入口無効: 新卒の選択肢が出ない",!/新卒/.test(txt));
  await p.screenshot({path:`${SHOTS}/disabled_${label.replace(" ","")}_q1.png`,fullPage:true});
  // 無効時にAPI直叩きで新卒送信 → 拒否
  const r=await p.request.post(BASE+"/api/diagnosis/guest",{data:{mode:"stylist",answers:[4,...Array(29).fill(0)],requestId:"x",declared:{setVersion:"stylist_newgrad_30_v1"}}});
  ok("入口無効: 新卒回答のAPI送信は拒否(4xx)",r.status()>=400&&r.status()<500,r.status()+" "+(await r.text()).slice(0,100));
  // マイページ
  await p.goto(BASE+"/stylist/mypage"); await p.waitForLoadState("networkidle");
  const mt=await p.locator("main").innerText();
  ok("マイページ: エラー画面ではない（正常表示が必須）",!/一時的に表示できません|エラーコード|処理中に問題が発生/.test(mt)&&p.url().endsWith("/stylist/mypage"));
  ok("マイページ: 新卒の見出し「あなたのタイプ」が表示される",/あなたのタイプ/.test(mt)&&(await p.getByRole("heading",{name:"あなたのタイプ"}).count()+await p.getByText("あなたのタイプ",{exact:true}).count())>0);
  ok("マイページ: 新卒ヘッダ表示",(await p.getByTestId("newgrad-header").count())>0, p.url());
  ok("マイページ: 経験年数・年収・市場価値・才能グラフが出ない",!/経験年数|年収|市場価値|才能|経験・実績|6つの/.test(mt)&&(await p.locator("main svg[role='img'], main canvas").count())===0,(mt.match(/.{0,12}(経験年数|年収|市場価値|才能|経験・実績|6つの).{0,12}/g)||[]).join(" | "));
  ok("マイページ: タイプ名(癒しのカリスマ)が出る",/癒しのカリスマ/.test(mt));
  await p.screenshot({path:`${SHOTS}/disabled_${label.replace(" ","")}_mypage.png`,fullPage:true});
  console.log(mt.slice(0,500).replace(/\n+/g," / "));
  await ctx.close();
 }
 await b.close(); require("fs").writeFileSync(__dirname+"/disabled_results.json",JSON.stringify(res,null,2));
 const f=res.filter(r=>!r.pass); console.log(`結果 ${res.length-f.length}/${res.length}`);
})();
