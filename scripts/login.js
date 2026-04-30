#!/usr/bin/env node
/**
 * ============================================
 *  tsinghua-campus-sync — 清华校园首次登录 & 指纹采集
 *  使用 puppeteer 打开浏览器，自动填写
 *  学号密码，等待用户完成二次认证，
 *  然后提取指纹数据 + Cookie 保存
 * ============================================
 *
 * 用法：
 *   node login.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const CAMPUS_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(CAMPUS_DIR, 'config.json');

const SSO_LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0';
const LEARN_ROAMING_PREFIX = 'https://learn.tsinghua.edu.cn/f/j_spring_security_thauth_roaming_entry';

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return {}; }
}

function writeConfig(config) {
  const old = readConfig();
  const merged = { ...old, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  console.log(`\n💾 配置已保存到: ${CONFIG_PATH}`);
}

async function main() {
  const config = readConfig();
  if (!config.username || !config.password) {
    console.error('❌ 请先在 config.json 中填写学号和密码');
    process.exit(1);
  }

  // 生成或使用已有 fingerprint
  if (!config.fingerPrint) {
    config.fingerPrint = crypto.randomUUID().replace(/-/g, '');
    console.log(`🔑 生成新设备指纹: ${config.fingerPrint}`);
    // 立即保存指纹到配置
    writeConfig({ fingerPrint: config.fingerPrint });
  } else {
    console.log(`🔑 使用已有设备指纹: ${config.fingerPrint.slice(0, 16)}...`);
  }

  console.log(`\n🌐 正在打开浏览器...`);
  console.log(`📋 用户: ${config.username}`);
  console.log(`\n⏳ 即将打开清华大学登录页面...`);
  console.log(`   脚本会自动填写学号密码并提交。`);
  console.log(`   如果出现二次认证，请在手机上确认。`);
  console.log(`   登录成功后脚本会自动保存指纹信息。\n`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // 存储捕获的数据
  let captured = {
    loginData: null,
    roamingUrl: null,
    roamingDone: false,
  };

  // 拦截请求获取表单提交数据（含 fingerprint）
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (req.method() === 'POST' && url.includes('/do/off/ui/auth/login/submit')) {
      const pd = req.postData();
      if (pd) {
        const params = new URLSearchParams(pd);
        captured.loginData = Object.fromEntries(params.entries());
        console.log(`  📍 捕获到登录表单数据 (fingerPrint=${captured.loginData.fingerPrint?.slice(0, 16)}...)`);
      }
    }
    req.continue();
  });

  // 拦截 roam 响应 → 登录成功！
  page.on('response', async resp => {
    const url = resp.url();
    if (url.startsWith(LEARN_ROAMING_PREFIX) && !captured.roamingDone) {
      captured.roamingDone = true;
      captured.roamingUrl = url;
      console.log(`  ✅ 登录成功！捕获到 roam 入口，等待 Cookie 就绪...`);

      // 等 roam 重定向完成，让 learn.tsinghua.edu.cn 设置 session cookie
      await new Promise(r => setTimeout(r, 3000));

      // 获取所有 cookie（包括 roam 后 learn 设置的 session）
      const cookies = await page.cookies();
      
      // 保存所有 tsinghua 相关域名下的 cookie
      const cookieObj = {};
      for (const c of cookies) {
        if (c.domain.includes('tsinghua.edu.cn')) {
          const key = c.name;
          if (!cookieObj[key] || key.includes('SESSION') || key.includes('JSESSION')) {
            cookieObj[key] = c.value;
          }
        }
      }

      // 额外：尝试访问 learn 首页确保会话建立
      try {
        // 先等 roam 重定向完成
        await new Promise(r => setTimeout(r, 2000));
        const currentUrl = page.url();
        if (!currentUrl.includes('learn.tsinghua.edu.cn')) {
          await page.goto('https://learn.tsinghua.edu.cn', { waitUntil: 'networkidle0', timeout: 15000 });
        }
        await new Promise(r => setTimeout(r, 2000));
        const finalCookies = await page.cookies();
        for (const c of finalCookies) {
          if (c.domain.includes('tsinghua.edu.cn') || c.domain.includes('learn.tsinghua')) {
            cookieObj[c.name] = c.value;
          }
        }
        console.log(`  🌐 learn.tsinghua.edu.cn 会话建立完成`);
      } catch (e) {
        console.log(`  ⚠️ 访问 learn 首页: ${e.message}`);
      }

      const COOKIE_PATH = path.join(CAMPUS_DIR, '_cookies.json');
      fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookieObj, null, 2) + '\n', 'utf-8');

      const saveData = {
        fingerPrint: config.fingerPrint,
        fingerGenPrint: captured.loginData?.fingerGenPrint || '',
        fingerGenPrint3: captured.loginData?.fingerGenPrint3 || '',
        lastLoginAt: new Date().toISOString(),
      };

      writeConfig(saveData);

      console.log(`\n  📊 保存的指纹数据:`);
      console.log(`     fingerPrint:     ${saveData.fingerPrint}`);
      console.log(`     fingerGenPrint:  ${saveData.fingerGenPrint ? saveData.fingerGenPrint.slice(0, 20) + '...' : '(空)'}`);
      console.log(`     fingerGenPrint3: ${saveData.fingerGenPrint3 ? saveData.fingerGenPrint3.slice(0, 20) + '...' : '(空)'}`);
      console.log(`     保存 Cookie: ${Object.keys(cookieObj).length} 个`);

      console.log(`\n  🎉 登录成功！马上可以同步数据了~`);
      console.log(`     运行: cd ${CAMPUS_DIR}/scripts && node fetch.js`);
    }
  });

  try {
    console.log('  正在加载清华登录页面...');
    await page.goto(SSO_LOGIN_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('  ✅ 页面加载完成');

    // 等待表单元素
    await page.waitForSelector('#i_user', { timeout: 10000 });
    await page.waitForSelector('#i_pass', { timeout: 10000 });

    // 获取页面中的 fingerPrint 字段值（页面 JS 生成的）
    const pageFP = await page.evaluate(() => {
      const fp = document.querySelector('[name="fingerPrint"]');
      return fp ? fp.value : null;
    });
    console.log(`  📍 页面生成的指纹: ${pageFP?.slice(0, 16)}...`);

    // 设置自己的指纹（覆盖页面的随机指纹）
    await page.evaluate((fp) => {
      const el = document.querySelector('[name="fingerPrint"]');
      if (el) el.value = fp;
    }, config.fingerPrint);
    console.log(`  ✅ 已设置咱自己的设备指纹`);

    // 填写用户名密码
    await page.evaluate((username, password) => {
      const u = document.querySelector('#i_user');
      const p = document.querySelector('#i_pass');
      if (u) { u.value = username; u.readOnly = true; }
      if (p) { p.value = password; p.readOnly = true; }
    }, config.username, config.password);
    console.log('  ✅ 已自动填写学号密码');

    // 勾选"单点登录"
    await page.evaluate(() => {
      const sl = document.querySelector('[name="singleLogin"]');
      if (sl && !sl.checked) sl.click();
    });
    console.log('  ✅ 已勾选单点登录');

    // 点击登录按钮
    await page.evaluate(() => {
      const btn = document.querySelector('#login_submit') || 
                  document.querySelector('button.btn-primary') ||
                  document.querySelector('input[type="submit"]');
      if (btn) btn.click();
    });
    console.log('  🔑 已提交登录表单');

    // 等待 roam 成功或超时（最多 3 分钟等二次认证）
    console.log('  ⏳ 等待二次认证完成（请在手机上确认）...\n');
    
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (captured.roamingDone) {
          clearInterval(check);
          // 给 cookie 保存和 learn 首页访问留时间
          setTimeout(resolve, 8000);
        }
      }, 500);
      // 超时 3 分钟后仍然退出
      setTimeout(() => {
        clearInterval(check);
        if (!captured.roamingDone) {
          console.log('\n  ⚠️  等待超时（3分钟）');
          console.log('     如果已在手机上完成认证，请检查浏览器页面。');
          resolve();
        }
      }, 180000);
    });

    if (!captured.roamingDone) {
      console.log(`\n  📍 当前页面 URL: ${page.url()}`);
      console.log(`  ⚠️  未检测到 roam 完成，指纹可能未保存。`);
    }

  } catch (err) {
    console.error(`\n❌ 错误: ${err.message}`);
  } finally {
    console.log(`\n  🔚 浏览器将在 3 秒后自动关闭...`);
    await new Promise(r => setTimeout(r, 3000));
    await browser.close();
    console.log(`  ✅ 浏览器已关闭`);
  }
}

main().catch(err => {
  console.error(`\n❌ 登录失败: ${err.message}`);
  process.exit(1);
});
