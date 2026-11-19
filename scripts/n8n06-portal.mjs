import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, copyFile, open, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const envKeys = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "COMSPEC", "PATHEXT"];
export async function stagePortal(root, directory) {
  const portal = path.join(directory, "portal");
  assert(portal.startsWith(path.join(root, ".local", "automation") + path.sep));
  const environment = Object.fromEntries(envKeys.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  const source = "apps/admin-portal/";
  const files = execFileSync("git", ["ls-files","--cached","--others","--exclude-standard","-z","--",source], { cwd:root, env:environment, encoding:"utf8" }).split("\0").filter(Boolean);
  await mkdir(portal);
  for (const file of new Set(files)) {
    assert(file.startsWith(source));
    const relative = file.slice(source.length);
    if (relative.split("/").some(part => /^\.env(?:\.|$)/.test(part) || [".next","out","node_modules"].includes(part))) continue;
    const destination = path.resolve(portal, relative);
    assert(destination.startsWith(portal + path.sep));
    await mkdir(path.dirname(destination), { recursive:true });
    await copyFile(path.join(root,file), destination);
  }
  const preload = path.join(root,"scripts/no-personal-env.cjs").replaceAll("\\", "/"), next = path.join(root,"node_modules/next/dist/bin/next");
  const env = { ...environment, NODE_OPTIONS:'--require "'+preload+'"', NODE_ENV:"production", NEXT_TELEMETRY_DISABLED:"1", NEXT_PUBLIC_ENABLE_MOCK:"false" };
  const log = await open(path.join(directory,"portal-build-private.log"),"wx",0o600);
  try {
    const child = spawn(process.execPath,[next,"build",portal],{cwd:portal,env,stdio:["ignore",log.fd,log.fd],windowsHide:true});
    const exit = await new Promise((resolve,reject)=>{child.once("exit",resolve);child.once("error",reject);});
    assert.equal(exit,0,"Isolated Portal build failed; review private build log");
  } finally { await log.close(); }
  return { portal, env, next };
}

export async function startPortal(h) {
  const { portal, env, next } = await stagePortal(h.root,h.directory);
  const gatewayPort = await h.freePort(), port = await h.freePort(), origin = "http://localhost:"+port;
  await h.startService("gateway",{ PORT:String(gatewayPort), HOST:"127.0.0.1" });
  const log = await open(path.join(h.directory,"portal-start-private.log"),"wx",0o600);
  const child = spawn(process.execPath,[next,"start",portal,"--hostname","127.0.0.1","--port",String(port)],{
    cwd:portal,env:{...env, GATEWAY_URL:"http://127.0.0.1:"+gatewayPort,PORTAL_ORIGIN:origin},stdio:["ignore",log.fd,log.fd],windowsHide:true,
  });
  h.children.push(child);
  await log.close();
  await h.eventually(async()=>{try{return (await fetch(origin+"/student/login")).ok;}catch{return false;}}, "isolated Portal startup");
  return origin;
}

async function staffLogin(page, origin, actor, password, route) {
  await page.goto(origin+"/login");
  await page.getByLabel("Email nhân viên",{exact:true}).fill(actor.email);
  await page.getByLabel("Mật khẩu",{exact:true}).fill(password);
  await page.getByRole("button",{name:/^Đăng nhập/}).click();
  await page.waitForURL(/\/dashboard\//);
  await page.goto(origin+"/dashboard/"+route);
}

export async function responsiveAcceptance({h, staff, director, accountant, password}) {
  const origin = await h.startPortal(), browser = await chromium.launch({channel:"msedge",headless:true});
  const screenshots = [];
  try {
    for (const [route, actor, title] of [
      ["adjustments",staff,"Điều chỉnh quyền lợi"],["class-changes",director,"Đổi lịch và hủy lớp"],
      ["refunds",accountant,"Thực hiện hoàn tiền"],["notifications",staff,"Thông báo học viên"],
    ]) {
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      await staffLogin(page,origin,actor,password,route);
      const heading=page.getByRole("heading",{name:title,exact:true}), sidebar=page.locator("#hub-sidebar");
      await heading.waitFor();
      for (const width of [1440,768,390]) {
        await page.setViewportSize({width,height:900});
        if (width < 901) {
          const toggle = page.getByRole("button",{name:"Mở menu"});
          await sidebar.waitFor({state:"hidden"});
          await toggle.press("Enter");
          await page.getByRole("button",{name:"Đóng menu",exact:true}).waitFor();
          assert.equal(await toggle.getAttribute("aria-expanded"),"true");
          await page.keyboard.press("Escape");
          await sidebar.waitFor({state:"hidden"});
          assert.equal(await toggle.getAttribute("aria-expanded"),"false");
          assert(await toggle.evaluate(element=>element===document.activeElement));
        } else await sidebar.waitFor({state:"visible"});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        const file="portal-"+route+"-"+width+".png";
        const bytes=await page.screenshot({path:path.join(h.directory,file),fullPage:true,animations:"disabled"});
        screenshots.push({file,width,sha256:createHash("sha256").update(bytes).digest("hex")});
      }
      await page.close();
    }
    return {screenshots,keyboardOpenClose:true,focusRestored:true};
  } finally { await browser.close(); }
}

export async function browserAcceptance({ h, api, confirmed, customer, student, offer, staff, director, accountant, password, waitDone }) {
  const origin = await h.startPortal();
  const source = await confirmed(), user = source.student;
  const browser = await chromium.launch({ channel:"msedge", headless:true });
  const screenshots = [], pageErrors = [];
  try {
    async function newPage() {
      const page = await browser.newPage({ viewport:{width:1440,height:900},acceptDownloads:true });
      page.on("pageerror",e=>pageErrors.push(e.name));
      return page;
    }
    async function studentLogin(actor, fromStaffLogin = false) {
      const page = await newPage();
      if (fromStaffLogin) {
        await page.goto(origin+"/login");
        await page.getByRole("link",{name:"Đăng nhập học viên"}).press("Enter");
        await page.waitForURL(origin+"/student/login");
      } else await page.goto(origin+"/student/login");
      await page.getByLabel("Email đã xác minh").fill(actor.email);
      await page.getByRole("button",{name:"Nhận mã đăng nhập"}).click();
      const input = page.getByLabel("Mã xác minh"); await input.waitFor();
      const latest = (await h.pools.identity.query("SELECT delivery_ref FROM otp_challenges WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1",[actor.id])).rows[0];
      const message = (await h.pools.notification.query("SELECT body FROM notification_mailbox WHERE intent_id=$1",[latest.delivery_ref])).rows[0];
      const code = message?.body.match(/\b\d{6}\b/)?.[0]; assert(code);
      await input.fill(code);
      await page.getByRole("button",{name:"Xác minh và đăng nhập"}).click();
      await page.waitForURL(origin+"/student");
      return page;
    }
    async function openStaff(actor, route) {
      const page = await newPage();
      await staffLogin(page,origin,actor,password,route);
      return page;
    }
    const page = await studentLogin(user, true);
    await page.getByRole("heading",{name:"Hồ sơ học viên"}).waitFor();
    const entitlement = page.locator('[data-enrollment-id="'+source.id+'"]');
    await entitlement.getByRole("button",{name:"Xem lịch và link lớp"}).click();
    await page.getByRole("link",{name:"Mở link lớp"}).waitFor();
    await page.getByLabel("Đăng ký",{exact:true}).selectOption(source.id);
    await page.getByLabel("Tên người nhận").fill("DEMO Người nhận");
    await page.getByLabel("Địa chỉ").fill("DEMO địa chỉ tổng hợp");
    await page.getByRole("button",{name:"Tạo hóa đơn mô phỏng"}).click();
    const downloadLink = page.getByRole("link",{name:"Tải hóa đơn"}); await downloadLink.waitFor();
    const invoiceRoute = await downloadLink.getAttribute("href"); assert(invoiceRoute);
    const download = page.waitForEvent("download"); await downloadLink.click();
    const invoice = await download, invoicePath = await invoice.path();
    assert((await readFile(invoicePath,"utf8")).includes("KHÔNG CÓ GIÁ TRỊ PHÁP LÝ"));
    const invoiceId = invoiceRoute.split("/").at(-2);
    const audit = (await h.pools.payment.query("SELECT action FROM payment_audit WHERE target_id=$1 ORDER BY action",[invoiceId])).rows.map(row=>row.action);
    assert.deepEqual(audit,["payment.invoice_created","payment.invoice_downloaded"]);
    await page.reload();
    await downloadLink.waitFor();
    assert(!await page.evaluate(()=>Object.values(localStorage).some(value=>/hub_access|refreshToken|accessToken/i.test(value))));
    const cookies = (await page.context().cookies()).filter(c=>["hub_access","hub_refresh"].includes(c.name));
    assert.equal(cookies.length,2); assert(cookies.every(c=>c.httpOnly));
    const otherPage = await studentLogin(await student((await customer()).learnerId));
    const crossSchedule = await otherPage.request.get(origin+"/api/v1/student/class-schedule/"+source.id);
    const crossInvoice = await otherPage.request.get(origin+invoiceRoute);
    assert([403,404].includes(crossSchedule.status()));
    assert.equal(crossInvoice.status(),404);

    const admin = await openStaff(staff, "adjustments");
    await admin.getByRole("heading",{name:"Điều chỉnh quyền lợi"}).waitFor();
    const finance = await openStaff(accountant, "adjustments");
    const approver = await openStaff(director, "adjustments");
    const reason = "DEMO hoàn toàn bộ học phí từ Portal";
    await finance.getByLabel("Mã đăng ký",{exact:true}).fill(source.id);
    const current = await api("enrollment", "/api/v1/student/enrollments/"+source.id, "GET", undefined, user.accessToken);
    await finance.getByLabel("Phiên bản quyền lợi").fill(String(current.currentEntitlement.version));
    await finance.getByLabel("Số tiền hoàn (VND)").fill("100000");
    await finance.getByLabel("Phương án hoàn").selectOption("CANCEL");
    await finance.getByLabel("Lý do",{exact:true}).fill(reason);
    await finance.getByRole("button",{name:"Gửi yêu cầu"}).press("Enter");
    const opened = finance.locator("[data-adjustment-id]").filter({ hasText:reason });
    await opened.getByText("Chờ duyệt",{exact:false}).waitFor();
    const id = await opened.getAttribute("data-adjustment-id"); assert(id);
    await admin.reload();
    const staffRow = admin.locator('[data-adjustment-id="'+id+'"]');
    await staffRow.waitFor();
    assert.equal(await staffRow.getByRole("button",{name:"Duyệt yêu cầu"}).count(),0);
    await approver.reload();
    const approved = approver.locator('[data-adjustment-id="'+id+'"]');
    await approved.getByRole("button",{name:"Duyệt yêu cầu"}).click();
    await approved.getByText("Đã duyệt",{exact:false}).waitFor();
    await page.reload();
    await page.getByRole("button",{name:"Đồng ý phương án",exact:true}).click();
    const waiting = await waitDone("WF-09",id,"WAITING");
    assert.equal((await api("payment","/api/v1/refunds/"+id,"GET",undefined,accountant.accessToken)).status,"RESERVED");
    await finance.goto(origin+"/dashboard/refunds");
    const refund = finance.locator('[data-refund-id="'+id+'"]');
    await refund.getByRole("button",{name:"Cho phép thực hiện hoàn mô phỏng"}).click();
    const execution = await waitDone("WF-09",id);
    const receipts = (await h.pools.payment.query("SELECT id,amount::int,adapter FROM synthetic_payment_executions WHERE adjustment_id=$1",[id])).rows;
    assert.equal(receipts.length,1); assert.equal(receipts[0].amount,100000); assert.equal(receipts[0].adapter,"SYNTHETIC");
    await finance.reload();
    await refund.getByText("Đã thực hiện",{exact:true}).waitFor();
    await refund.getByText("Chứng từ mô phỏng "+receipts[0].id).waitFor();
    await page.reload();
    await entitlement.getByText("Đã hủy",{exact:true}).waitFor();
    const cls = await offer(), classRow = await api("class-schedule","/api/v1/classes/"+cls.classId);
    const planned = await api("class-schedule","/api/v1/class-changes","POST",{
      classId:cls.classId,classVersion:classRow.version,kind:"CANCEL",reason:"DEMO hủy lớp trống bằng phê duyệt Portal",
    },h.operator.accessToken,201,randomUUID());
    await approver.goto(origin+"/dashboard/class-changes");
    await approver.getByRole("heading",{name:"Đổi lịch và hủy lớp"}).waitFor();
    const planRow = approver.locator('[data-change-id="'+planned.id+'"]');
    await planRow.getByRole("button",{name:"Quyết định phương án"}).click();
    await approver.getByLabel("Lý do quyết định").fill("DEMO giám đốc kiểm tra lớp trống");
    await approver.getByRole("button",{name:"Lưu quyết định"}).click();
    const classExecution = await waitDone("WF-08",planned.id);
    await approver.reload();
    await planRow.getByText("Đã thực hiện",{exact:false}).waitFor();
    const notices = await openStaff(staff, "notifications");
    await notices.getByRole("heading",{name:"Thông báo học viên"}).waitFor();
    await notices.getByText("Chứng từ nhận",{exact:false}).first().waitFor();
    for (const [name, client] of [["learner",page],["adjustments",admin],["class-changes",approver],["refunds",finance],["notifications",notices]]) for (const width of [1440,768,390]) {
      await client.setViewportSize({width,height:900});
      assert(await client.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1),"No page-level horizontal overflow "+name+" "+width);
      const file = "portal-"+name+"-"+width+".png";
      const bytes = await client.screenshot({ path:path.join(h.directory,file),fullPage:true,animations:"disabled" });
      screenshots.push({ file,width,sha256:createHash("sha256").update(bytes).digest("hex") });
    }
    assert.deepEqual(pageErrors,[]);
    return { screenshots, enrollmentId:source.id, invoiceFilename:invoice.suggestedFilename(), studentLogin:true, reload:true,
      crossSchedule:crossSchedule.status(), crossInvoice:crossInvoice.status(), adjustmentId:id, waiting, execution, classExecution, invoiceAudit:audit, refundReceiptId:receipts[0].id };
  } finally { await browser.close(); }
}
