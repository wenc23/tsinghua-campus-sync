#!/usr/bin/env node
/**
 * ============================================
 *  小鈴 🎀 — 校园数据查询工具
 *  查询本地缓存的课表/作业/通知/文件
 * ============================================
 *
 * 用法：
 *   node query.js today              # 今天课表+作业
 *   node query.js tomorrow           # 明天
 *   node query.js week               # 本周
 *   node query.js 2026-04-30         # 指定日期
 *   node query.js month              # 本月概览
 *   node query.js homework           # 未提交作业
 *   node query.js homework --all     # 全部作业
 *   node query.js course "课程名"    # 某课程详情
 *   node query.js notifications      # 最近通知
 *   node query.js files              # 最近文件
 *   node query.js upcoming           # 即将截止作业+课程
 *   node query.js stats              # 数据概览（同步状态）
 */

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const CAMPUS_DIR = path.resolve(__dirname, '..');
const COURSES_DIR = path.join(CAMPUS_DIR, 'courses');
const CAL_DAILY_DIR = path.join(CAMPUS_DIR, 'calendar/daily');
const MERGED_DIR = path.join(CAMPUS_DIR, 'merged');
const SYNC_PATH = path.join(CAMPUS_DIR, '_sync.json');
const CURRENT_PATH = path.join(CAMPUS_DIR, 'current.json');

const args = process.argv.slice(2);

// ============ 工具 ============

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return null; }
}

function readDaily(dateStr) {
  return readJSON(path.join(CAL_DAILY_DIR, `${dateStr}.json`));
}

function listCourses() {
  const idx = readJSON(path.join(COURSES_DIR, 'index.json'));
  return idx ? idx.items : [];
}

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(dateStr) {
  const d = dayjs(dateStr);
  return `${d.format('M月D日')} ${DAY_NAMES[d.day()]}`;
}

function formatTime(t) { return t || '--:--'; }

function getToday() { return dayjs().format('YYYY-MM-DD'); }
function getWeekBoundary() {
  const now = dayjs();
  const start = now.day(0); // 周日
  const end = start.add(6, 'day');
  return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}

// ============ 显示函数 ============

function showDaily(dateStr) {
  const data = readDaily(dateStr);
  if (!data || !data.entries || data.entries.length === 0) {
    console.log(`📭 ${formatDate(dateStr)} 无日程安排\n`);
    return;
  }

  console.log(`\n📅 ${formatDate(dateStr)} — ${data.count} 项\n`);

  const courses = data.entries.filter(e => e.type === 'course');
  const assignments = data.entries.filter(e => e.type === 'assignment');

  if (courses.length > 0) {
    console.log('  ── 📖 课程 ──');
    for (const c of courses) {
      const time = c.startTime && c.endTime ? `${formatTime(c.startTime)}-${formatTime(c.endTime)}` : '';
      const loc = c.location ? ` @${c.location}` : '';
      console.log(`    ${time} ${c.courseName}${loc}`);
    }
    console.log('');
  }

  if (assignments.length > 0) {
    console.log('  ── 📝 作业截止 ──');
    for (const a of assignments) {
      const status = a.submitted ? '✅' : '⏳';
      console.log(`    ${status} ${a.title} (${a.courseName}) [截止 ${a.deadline}]`);
    }
    console.log('');
  }
}

function showWeek() {
  const { start, end } = getWeekBoundary();
  console.log(`\n📅 本周 ${formatDate(start)} ~ ${formatDate(end)}\n`);

  let totalCourses = 0;
  let totalAssignments = 0;

  let d = dayjs(start);
  while (d.isBefore(dayjs(end).add(1, 'day'))) {
    const dateStr = d.format('YYYY-MM-DD');
    const data = readDaily(dateStr);
    if (data && data.entries && data.entries.length > 0) {
      const courses = data.entries.filter(e => e.type === 'course');
      const assignments = data.entries.filter(e => e.type === 'assignment');
      totalCourses += courses.length;
      totalAssignments += assignments.length;

      console.log(`  ${formatDate(dateStr)}:`);
      if (courses.length > 0) {
        console.log(`    📖 ${courses.map(c => `${c.courseName}(${formatTime(c.startTime)}-${formatTime(c.endTime)})`).join('、')}`);
      }
      if (assignments.length > 0) {
        console.log(`    📝 ${assignments.map(a => `${a.title.replace('📝 ', '')} [${a.submitted ? '✅' : '⏳'}]`).join('、')}`);
      }
      console.log('');
    }
    d = d.add(1, 'day');
  }

  if (totalCourses === 0 && totalAssignments === 0) {
    console.log('  📭 本周暂无日程安排\n');
  } else {
    console.log(`  合计: ${totalCourses} 门课, ${totalAssignments} 项作业\n`);
  }
}

function showMonth() {
  const now = dayjs();
  const monthStr = now.format('YYYY-MM');
  console.log(`\n📅 ${now.format('YYYY年M月')} 概览\n`);

  const days = [];
  const daysInMonth = now.daysInMonth();
  let totalCourses = 0;
  let totalAssignments = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const data = readDaily(dateStr);
    if (data && data.entries && data.entries.length > 0) {
      const courses = data.entries.filter(e => e.type === 'course');
      const assignments = data.entries.filter(e => e.type === 'assignment');
      totalCourses += courses.length;
      totalAssignments += assignments.length;
      const prefix = dateStr === getToday() ? '▶ ' : '  ';
      console.log(`${prefix}${formatDate(dateStr)}: 📖${courses.length} 📝${assignments.length}`);
    }
  }

  console.log(`\n  合计: ${totalCourses} 节课, ${totalAssignments} 项作业截止\n`);
}

function showHomework(allFlag) {
  const data = readJSON(path.join(MERGED_DIR, 'assignments.json'));
  if (!data) { console.log('📭 暂无作业数据，请先运行 fetch.js 同步\n'); return; }

  const items = allFlag ? data.items : data.items.filter(a => !a.submitted && (!a.deadline || dayjs(a.deadline).isAfter(dayjs())));
  const overdue = data.items.filter(a => !a.submitted && a.deadline && dayjs(a.deadline).isBefore(dayjs()));

  console.log(`\n📋 作业列表 (${items.length}/${data.count})${allFlag ? ' [全部]' : ' [未提交+未过期]'}\n`);

  if (overdue.length > 0 && !allFlag) {
    console.log(`  ⚠️  已逾期 ${overdue.length} 项:\n`);
    for (const a of overdue) {
      console.log(`    🔴 ${a.title} (${a.courseName}) — 截止 ${dayjs(a.deadline).format('M月D日 HH:mm')}`);
    }
    console.log('');
  }

  for (const a of items) {
    const status = a.submitted ? '✅' : (a.graded ? '📊' : '⏳');
    const deadline = a.deadline ? dayjs(a.deadline).format('M月D日 HH:mm') : '无截止日期';
    const daysLeft = a.deadline ? dayjs(a.deadline).diff(dayjs(), 'day') : null;
    const urgent = daysLeft !== null && daysLeft <= 3 && !a.submitted ? ' ⚡' : '';

    console.log(`  ${status} ${a.title}${urgent}`);
    console.log(`      ${a.courseName} · 截止 ${deadline}${daysLeft !== null ? ` (还剩${daysLeft}天)` : ''}`);
    if (a.grade !== undefined && a.grade !== null) {
      console.log(`      成绩: ${a.grade}`);
    }
    console.log('');
  }
}

function showCourse(keyword) {
  const courses = listCourses();
  const matches = courses.filter(c =>
    c.name.includes(keyword) || c.id.includes(keyword) || (c.teacherName && c.teacherName.includes(keyword))
  );

  if (matches.length === 0) {
    console.log(`🔍 未找到匹配「${keyword}」的课程\n`);
    return;
  }

  for (const mc of matches) {
    const courseId = mc.id;
    const dir = path.join(COURSES_DIR, courseId);

    const info = readJSON(path.join(dir, 'info.json'));
    const schedule = readJSON(path.join(dir, 'schedule.json'));
    const assignments = readJSON(path.join(dir, 'assignments.json'));
    const notifications = readJSON(path.join(dir, 'notifications.json'));
    const files = readJSON(path.join(dir, 'files.json'));

    console.log(`\n📚 ${mc.name}`);
    console.log(`   教师: ${mc.teacherName || info?.teacherName || '未知'}`);
    if (info) {
      console.log(`   编号: ${info.courseNumber || ''} | 索引: ${info.courseIndex ?? ''}`);
    }

    if (schedule && schedule.length > 0) {
      console.log(`\n  ── 🕐 上课时间 ──`);
      for (const s of schedule.slice(0, 8)) {
        const weekStr = s.weeks && s.weeks.length > 0
          ? (s.weeks.length > 3 ? `第${s.weeks[0]}-${s.weeks[s.weeks.length - 1]}周` : s.weeks.map(w => `第${w}周`).join(','))
          : '全周';
        const loc = s.location ? ` @${s.location}` : '';
        console.log(`    ${DAY_NAMES[s.dayOfWeek]} ${s.startPeriod}-${s.endPeriod}节 (${s.startTime}-${s.endTime}) ${weekStr}${loc}`);
      }
      if (schedule.length > 8) console.log(`    ... 还有 ${schedule.length - 8} 条`);
    }

    if (assignments) {
      const unsubmitted = assignments.items.filter(a => !a.submitted);
      const graded = assignments.items.filter(a => a.graded);
      console.log(`\n  ── 📝 作业 (共${assignments.count}, 未提交${unsubmitted.length}) ──`);
      for (const a of unsubmitted.slice(0, 5)) {
        const daysLeft = a.deadline ? dayjs(a.deadline).diff(dayjs(), 'day') : null;
        const deadline = a.deadline ? dayjs(a.deadline).format('M月D日 HH:mm') : '无截止';
        console.log(`    ⏳ ${a.title} (截止 ${deadline}${daysLeft !== null ? `, 剩${daysLeft}天` : ''})`);
      }
      if (unsubmitted.length > 5) console.log(`    ... 还有 ${unsubmitted.length - 5} 项未提交`);
    }

    if (notifications) {
      console.log(`\n  ── 📢 通知 (共${notifications.count}) ──`);
      for (const n of notifications.items.slice(0, 3)) {
        const time = n.publishTime ? dayjs(n.publishTime).format('M月D日') : '';
        const important = n.markedImportant ? ' 🔴' : '';
        const unread = n.hasRead === false ? ' [未读]' : '';
        console.log(`    ${time} ${n.title}${important}${unread}`);
      }
    }

    if (files) {
      console.log(`\n  ── 📁 文件 (共${files.count}) ──`);
      for (const f of files.items.slice(0, 3)) {
        const time = f.uploadTime ? dayjs(f.uploadTime).format('M月D日') : '';
        const isNew = f.isNew ? ' 🆕' : '';
        console.log(`    ${time} ${f.title} (${f.size || '?'})${isNew}`);
      }
    }
    console.log('');
  }
}

function showNotifications() {
  const data = readJSON(path.join(MERGED_DIR, 'notifications.json'));
  if (!data) { console.log('📭 暂无通知数据\n'); return; }

  const unread = data.items.filter(n => n.hasRead === false);

  console.log(`\n📢 通知 (共${data.count}, 未读${unread.length})\n`);

  for (const n of data.items.slice(0, 15)) {
    const time = n.publishTime ? dayjs(n.publishTime).format('M月D日 HH:mm') : '';
    const important = n.markedImportant ? '🔴 ' : '';
    const unreadTag = n.hasRead === false ? '[未读] ' : '';
    console.log(`  ${important}${unreadTag}${n.title}`);
    console.log(`     ${n.courseName} · ${time}`);
    console.log('');
  }
  if (data.items.length > 15) console.log(`  ... 还有 ${data.items.length - 15} 条\n`);
}

function showFiles() {
  const data = readJSON(path.join(MERGED_DIR, 'files.json'));
  if (!data) { console.log('📭 暂无文件数据\n'); return; }

  const newFiles = data.items.filter(f => f.isNew);

  console.log(`\n📁 文件 (共${data.count}, 新${newFiles.length})\n`);

  for (const f of data.items.slice(0, 15)) {
    const time = f.uploadTime ? dayjs(f.uploadTime).format('M月D日') : '';
    const isNew = f.isNew ? '🆕 ' : '';
    console.log(`  ${isNew}${f.title}`);
    console.log(`     ${f.courseName} · ${f.size || '?'} · ${time}`);
    console.log('');
  }
  if (data.items.length > 15) console.log(`  ... 还有 ${data.items.length - 15} 条\n`);
}

function showUpcoming() {
  const data = readJSON(path.join(MERGED_DIR, 'assignments.json'));
  if (!data) { console.log('📭 暂无数据\n'); return; }

  const now = dayjs();
  const upcoming = data.items
    .filter(a => !a.submitted && a.deadline && dayjs(a.deadline).isAfter(now) && dayjs(a.deadline).diff(now, 'day') <= 14)
    .sort((a, b) => dayjs(a.deadline).unix() - dayjs(b.deadline).unix());

  if (upcoming.length === 0) {
    console.log('🎉 最近两周没有即将截止的作业~\n');
    return;
  }

  console.log(`\n⏰ 未来两周截止的作业 (${upcoming.length} 项)\n`);

  for (const a of upcoming) {
    const daysLeft = dayjs(a.deadline).diff(now, 'day');
    const hoursLeft = dayjs(a.deadline).diff(now, 'hour') % 24;
    const urgent = daysLeft <= 3 ? ' 🔴⚡' : '';
    const timeStr = daysLeft > 0
      ? `还剩 ${daysLeft} 天 ${hoursLeft} 小时`
      : `今天! ${dayjs(a.deadline).format('HH:mm')} 截止`;

    console.log(`  ${a.title}${urgent}`);
    console.log(`     ${a.courseName} · ${timeStr} (${dayjs(a.deadline).format('M月D日 HH:mm')})`);
    console.log('');
  }
}

function showStats() {
  const sync = readJSON(SYNC_PATH);
  const courses = listCourses();

  if (!sync) {
    console.log('📭 尚未同步过校园数据。请先运行:\n');
    console.log('  node fetch.js\n');
    return;
  }

  const lastSync = dayjs(sync.lastSyncAt);
  const now = dayjs();
  const hoursAgo = now.diff(lastSync, 'hour');

  console.log('\n🏫 校园数据概览\n');
  console.log(`  📅 学期:     ${sync.semester?.id || '未知'}`);
  console.log(`  📚 课程:     ${sync.courseCount} 门`);
  console.log(`  📋 上次同步: ${hoursAgo < 1 ? '刚刚' : `${hoursAgo} 小时前`}`);
  console.log(`     (${sync.lastSyncAt})`);
  console.log('');

  if (sync.stats) {
    const s = sync.stats;
    console.log(`  📖 日历事件: ${s.calendarEvents || 0}`);
    console.log(`  📝 作业:     ${s.assignments || 0}`);
    console.log(`  📢 通知:     ${s.notifications || 0}`);
    console.log(`  📁 文件:     ${s.files || 0}`);
    console.log(`  📅 日历条目: ${s.calendarEntries || 0}`);
    console.log('');
  }

  if (courses.length > 0) {
    console.log('  课程列表:');
    for (const c of courses) {
      console.log(`    · ${c.name} (${c.teacherName || '?'})`);
    }
    console.log('');
  }
}

// ============ 主入口 ============

function main() {
  const cmd = args[0];
  if (!cmd) {
    console.log('\n🎀 小鈴 · 校园数据查询\n');
    console.log('用法:');
    console.log('  node query.js today             今天');
    console.log('  node query.js week              本周');
    console.log('  node query.js month             本月');
    console.log('  node query.js homework          未提交作业');
    console.log('  node query.js homework --all    全部作业');
    console.log('  node query.js upcoming          即将截止');
    console.log('  node query.js notifications     通知');
    console.log('  node query.js files             文件');
    console.log('  node query.js course "名称"     课程详情');
    console.log('  node query.js 2026-04-30        指定日期');
    console.log('  node query.js stats             概览');
    console.log('');
    return;
  }

  switch (cmd) {
    case 'today':
    case '今天':
      showDaily(getToday());
      break;

    case 'tomorrow':
    case '明天':
      showDaily(dayjs().add(1, 'day').format('YYYY-MM-DD'));
      break;

    case 'week':
    case '本周':
      showWeek();
      break;

    case 'month':
    case '本月':
      showMonth();
      break;

    case 'homework':
    case '作业':
      showHomework(args.includes('--all') || args.includes('-a'));
      break;

    case 'upcoming':
    case '即将':
      showUpcoming();
      break;

    case 'notifications':
    case '通知':
      showNotifications();
      break;

    case 'files':
    case '文件':
      showFiles();
      break;

    case 'stats':
    case '状态':
      showStats();
      break;

    case 'course':
    case '课程':
      const keyword = args[1];
      if (!keyword) { console.log('请指定课程名称，如: node query.js course "数字系统设计"\n'); return; }
      showCourse(keyword);
      break;

    default:
      // 尝试作为日期
      if (/^\d{4}-\d{2}-\d{2}$/.test(cmd)) {
        showDaily(cmd);
      } else if (/^\d{4}\d{2}\d{2}$/.test(cmd)) {
        showDaily(dayjs(cmd, 'YYYYMMDD').format('YYYY-MM-DD'));
      } else {
        console.log(`❌ 未知命令: ${cmd}\n`);
        main();
      }
  }
}

main();
