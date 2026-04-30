#!/usr/bin/env node
/**
 * ============================================
 *  小鈴 🎀 — 清华校园数据抓取引擎
 *  基于 thu-learn-lib，将清华网络学堂的
 *  课表/作业/通知/文件 映射为统一日历结构
 * ============================================
 *
 * 用法：
 *   node fetch.js                    # 全量同步
 *   node fetch.js --dry-run          # 模拟运行，不写文件
 *   node fetch.js --verbose          # 调试输出
 *   node fetch.js --force            # 强制重新拉取全部
 *
 * 输出：~/suzu_storage/campus/
 */

const fs = require('fs');
const path = require('path');
const { Learn2018Helper, ContentType } = require('thu-learn-lib');
const dayjs = require('dayjs');

// ============ 配置 ============
const CAMPUS_DIR = path.resolve(__dirname, '..');
const DATA_DIR = CAMPUS_DIR;
const COURSES_DIR = path.join(DATA_DIR, 'courses');
const CAL_DAILY_DIR = path.join(DATA_DIR, 'calendar/daily');
const CAL_MONTHLY_DIR = path.join(DATA_DIR, 'calendar/monthly');
const MERGED_DIR = path.join(DATA_DIR, 'merged');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SYNC_PATH = path.join(DATA_DIR, '_sync.json');

const PERIOD_TIMES = {
  1: ['08:00', '08:45'],
  2: ['08:50', '09:35'],
  3: ['09:50', '10:35'],
  4: ['10:40', '11:25'],
  5: ['11:30', '12:15'],
  6: ['13:30', '14:15'],
  7: ['14:20', '15:05'],
  8: ['15:20', '16:05'],
  9: ['16:10', '16:55'],
  10: ['17:00', '17:45'],
  11: ['18:00', '18:45'],
  12: ['18:50', '19:35'],
  13: ['19:40', '20:25'],
};

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_NAMES_MAP = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

// ============ CLI args ============
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const FORCE = args.includes('--force');

function log(...msg) { console.log(...msg); }
function debug(...msg) { if (VERBOSE) console.debug('[DEBUG]', ...msg); }

// ============ 工具函数 ============

function mkdirp(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return null; }
}

function writeJSON(p, data) {
  if (DRY_RUN) { debug(`[DRY] would write ${p}`); return; }
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function safeStr(s) {
  return String(s || '').trim();
}

function generateId(prefix, ...parts) {
  return prefix + '-' + parts.filter(Boolean).join('-').replace(/[^a-zA-Z0-9\-_]/g, '_');
}

/** 计算学期第几周 */
function calcWeekNumber(dateStr, semesterStart) {
  if (!semesterStart) return null;
  const d = dayjs(dateStr);
  const start = dayjs(semesterStart);
  const diff = d.diff(start, 'day');
  if (diff < 0) return null;
  return Math.floor(diff / 7) + 1;
}

/** 星期几的数字 (0=周日) */
function dayOfWeek(dateStr) {
  return dayjs(dateStr).day();
}

// ============ 排课解析 ============

/**
 * 解析 timeAndLocation 字符串
 * 格式: '星期六第1节(9,11周)，六教6A414'
 * 或: '星期第0节(全周)，' (非法/占位)
 * 或: '星期一第1节(单周)，六教' / '星期一第1节(双周)，六教'
 */
function parseTimeSlot(raw) {
  if (!raw || !raw.trim()) return null;
  raw = raw.trim();

  const locSep = raw.indexOf('，');
  const timePart = locSep >= 0 ? raw.slice(0, locSep) : raw;
  const location = locSep >= 0 ? raw.slice(locSep + 1).trim() : '';

  // 星期X
  const dayMatch = timePart.match(/星期([日一二三四五六])第(\d+)节/);
  if (!dayMatch) return null;

  const dayOfWeek = DAY_NAMES_MAP[dayMatch[1]];
  const startPeriod = parseInt(dayMatch[2]);
  if (isNaN(startPeriod)) return null;

  // 推测 endPeriod (连续节次: 第2节,第3节... 处理不了，用 startPeriod 默认)
  // 实际上 getCalendar 返回的事件有明确的时间段
  let endPeriod = startPeriod;

  // 周次范围: (全周) / (单周) / (双周) / (M,N周) / (M,N,P,Q周)
  const weekMatch = timePart.match(/\((.+?)\)/);
  let weeks = [];
  if (weekMatch) {
    const weekStr = weekMatch[1];
    if (weekStr === '全周') {
      // 全周，用标记表示，后续用所有周
    } else if (weekStr === '单周' || weekStr === '单') {
      // 标记为单周
    } else if (weekStr === '双周' || weekStr === '双') {
      // 标记为双周
    } else {
      // 多段: "9,11周" 或 "1,3,5周" 或 "1-8,12周"
      const segments = weekStr.replace('周', '').split(',');
      for (const seg of segments) {
        const range = seg.split('-');
        if (range.length === 2) {
          for (let i = parseInt(range[0]); i <= parseInt(range[1]); i++) weeks.push(i);
        } else {
          const n = parseInt(seg);
          if (!isNaN(n)) weeks.push(n);
        }
      }
    }
  }

  const times = getPeriodTimes(startPeriod, endPeriod);

  return {
    dayOfWeek,        // 0-6
    startPeriod,       // 1-13
    endPeriod,         // 1-13
    startTime: times[0],
    endTime: times[1],
    weekPattern: weekMatch ? weekMatch[1] : '',
    weeks,              // 具体周次列表（空=全周/单双周待解析）
    location,
  };
}

function getPeriodTimes(start, end) {
  const s = PERIOD_TIMES[start];
  const e = PERIOD_TIMES[end];
  if (s && e) return [s[0], e[1]];
  if (s) return s;
  return ['00:00', '00:00'];
}

/**
 * 展开某课程的排课到学期所有周次
 * 返回 ScheduleSlot[]
 */
function expandSchedule(course, semesterStart, semesterEnd) {
  const slots = [];
  if (!course.timeAndLocation || !Array.isArray(course.timeAndLocation)) return slots;

  const totalWeeks = semesterStart && semesterEnd
    ? Math.ceil(dayjs(semesterEnd).diff(dayjs(semesterStart), 'day') / 7)
    : 20; // 默认20周

  for (const raw of course.timeAndLocation) {
    const parsed = parseTimeSlot(raw);
    if (!parsed) continue;

    // 确定该槽适用的周次
    const { weeks, weekPattern, dayOfWeek, startPeriod, endPeriod, startTime, endTime, location } = parsed;
    let finalWeeks = [];

    if (weekPattern === '全周' || !weekPattern) {
      for (let w = 1; w <= totalWeeks; w++) finalWeeks.push(w);
    } else if (weekPattern === '单周' || weekPattern === '单') {
      for (let w = 1; w <= totalWeeks; w += 2) finalWeeks.push(w);
    } else if (weekPattern === '双周' || weekPattern === '双') {
      for (let w = 2; w <= totalWeeks; w += 2) finalWeeks.push(w);
    } else if (weeks.length > 0) {
      finalWeeks = weeks;
    }

    // 过滤超出学期的周次
    if (semesterStart && semesterEnd) {
      finalWeeks = finalWeeks.filter(w => {
        const weekDate = dayjs(semesterStart).add((w - 1) * 7, 'day');
        return weekDate.isBefore(dayjs(semesterEnd).add(1, 'day'));
      });
    }

    slots.push({
      dayOfWeek,
      startPeriod,
      endPeriod,
      startTime,
      endTime,
      weeks: finalWeeks,
      location,
      raw,
    });
  }

  return slots;
}

// ============ 构建日历条目 ============

/**
 * 从课程排课生成日历条目
 */
function buildCourseCalendarEntries(courses, schedules, semesterStart) {
  const entries = [];

  for (const course of courses) {
    const schedule = schedules[course.id] || [];
    for (const slot of schedule) {
      for (const week of slot.weeks) {
        // 计算该周对应的日期
        let date;
        if (semesterStart) {
          date = dayjs(semesterStart).add((week - 1) * 7, 'day');
          // 偏移到正确的星期几
          const currentDay = date.day();
          const targetDay = slot.dayOfWeek;
          date = date.add(targetDay - currentDay, 'day');
        } else {
          continue; // 没有学期起始日期无法计算
        }

        const dateStr = date.format('YYYY-MM-DD');
        const id = generateId('cal', course.id, dateStr, `p${slot.startPeriod}`);

        entries.push({
          id,
          type: 'course',
          date: dateStr,
          dayOfWeek: slot.dayOfWeek,
          weekNumber: week,
          title: course.name,
          courseId: course.id,
          courseName: course.name,
          startTime: slot.startTime,
          endTime: slot.endTime,
          location: slot.location,
          status: '',
          description: '',
        });
      }
    }
  }

  return entries;
}

/**
 * 从 API 日历事件生成日历条目（更精确，直接从学校API获取）
 */
function buildAPICalendarEntries(apiEvents, courseMap) {
  const entries = [];

  for (const ev of apiEvents) {
    const dateStr = dayjs(ev.date, 'YYYYMMDD').format('YYYY-MM-DD');
    const courseId = courseMap[ev.courseName] || 'unknown';
    const id = generateId('cal', 'api', dateStr, ev.startTime?.replace(':', ''));

    entries.push({
      id,
      type: 'course',
      date: dateStr,
      dayOfWeek: dayOfWeek(dateStr),
      weekNumber: null, // 由查询时计算
      title: ev.courseName,
      courseId,
      courseName: ev.courseName,
      startTime: ev.startTime,
      endTime: ev.endTime,
      location: ev.location || '',
      status: ev.status || '',
      description: '',
    });
  }

  return entries;
}

/**
 * 从作业生成日历条目（截止日期标记）
 */
function buildAssignmentCalendarEntries(assignments) {
  const entries = [];

  for (const a of assignments) {
    if (!a.deadline) continue;
    const deadlineStr = dayjs(a.deadline).format('YYYY-MM-DD');
    const id = generateId('asgn', a.id);

    entries.push({
      id,
      type: 'assignment',
      date: deadlineStr,
      dayOfWeek: dayOfWeek(deadlineStr),
      weekNumber: null,
      title: '📝 ' + a.title,
      courseId: a.courseId,
      courseName: a.courseName,
      startTime: null,
      endTime: null,
      location: '',
      status: a.submitted ? 'submitted' : (a.graded ? 'graded' : 'pending'),
      description: a.description || '',
      deadline: dayjs(a.deadline).format('YYYY-MM-DD HH:mm'),
      submitted: a.submitted,
      graded: a.graded,
      isLate: a.isLateSubmission,
    });
  }

  return entries;
}

// ============ 保存数据 ============

function saveCalendarData(dailyEntries, allAssignments) {
  // 按日期分组
  const byDate = {};
  for (const entry of dailyEntries) {
    if (!byDate[entry.date]) byDate[entry.date] = [];
    byDate[entry.date].push(entry);
  }

  // 写每日日历
  for (const [date, entries] of Object.entries(byDate)) {
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'course' ? -1 : 1;
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      return 0;
    });
    writeJSON(path.join(CAL_DAILY_DIR, `${date}.json`), {
      date,
      dayOfWeek: dayOfWeek(date),
      count: entries.length,
      entries,
    });
  }

  // 写月度汇总
  const byMonth = {};
  for (const [date, entries] of Object.entries(byDate)) {
    const month = date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { courses: 0, assignments: 0, days: {} };
    byMonth[month].days[date] = {
      count: entries.length,
      courses: entries.filter(e => e.type === 'course').length,
      assignments: entries.filter(e => e.type === 'assignment').length,
    };
    byMonth[month].courses += entries.filter(e => e.type === 'course').length;
    byMonth[month].assignments += entries.filter(e => e.type === 'assignment').length;
  }
  for (const [month, data] of Object.entries(byMonth)) {
    writeJSON(path.join(CAL_MONTHLY_DIR, `${month}.json`), {
      month,
      summary: data,
      // 不存完整条目以免太大，按月查询时读每日文件
    });
  }

  // 写日历总索引
  writeJSON(path.join(DATA_DIR, 'calendar/index.json'), {
    totalEntries: dailyEntries.length,
    dateRange: dailyEntries.length > 0
      ? { from: dailyEntries[0].date, to: dailyEntries[dailyEntries.length - 1].date }
      : null,
    dates: Object.keys(byDate).sort(),
    updatedAt: new Date().toISOString(),
  });
}

function saveCourseData(course, schedule, assignments, notifications, files) {
  const dir = path.join(COURSES_DIR, course.id);
  mkdirp(dir);

  writeJSON(path.join(dir, 'info.json'), course);
  writeJSON(path.join(dir, 'schedule.json'), schedule);

  if (assignments && assignments.length > 0) {
    writeJSON(path.join(dir, 'assignments.json'), {
      courseId: course.id,
      courseName: course.name,
      count: assignments.length,
      items: assignments,
    });
  }

  if (notifications && notifications.length > 0) {
    writeJSON(path.join(dir, 'notifications.json'), {
      courseId: course.id,
      courseName: course.name,
      count: notifications.length,
      items: notifications,
    });
  }

  if (files && files.length > 0) {
    writeJSON(path.join(dir, 'files.json'), {
      courseId: course.id,
      courseName: course.name,
      count: files.length,
      items: files,
    });
  }
}

function saveMergedViews(allAssignments, allNotifications, allFiles, dailyEntries) {
  // 汇总作业（按截止时间排序）
  const sortedAssignments = [...allAssignments].sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return dayjs(a.deadline).unix() - dayjs(b.deadline).unix();
  });
  writeJSON(path.join(MERGED_DIR, 'assignments.json'), {
    count: sortedAssignments.length,
    updatedAt: new Date().toISOString(),
    items: sortedAssignments,
  });

  // 汇总通知（按发布时间排序）
  const sortedNotices = [...allNotifications].sort((a, b) => {
    if (!a.publishTime) return 1;
    if (!b.publishTime) return -1;
    return dayjs(b.publishTime).unix() - dayjs(a.publishTime).unix();
  });
  writeJSON(path.join(MERGED_DIR, 'notifications.json'), {
    count: sortedNotices.length,
    updatedAt: new Date().toISOString(),
    items: sortedNotices,
  });

  // 汇总文件（按上传时间排序）
  const sortedFiles = [...allFiles].sort((a, b) => {
    if (!a.uploadTime) return 1;
    if (!b.uploadTime) return -1;
    return dayjs(b.uploadTime).unix() - dayjs(a.uploadTime).unix();
  });
  writeJSON(path.join(MERGED_DIR, 'files.json'), {
    count: sortedFiles.length,
    updatedAt: new Date().toISOString(),
    items: sortedFiles,
  });

  // 日历完整视图
  writeJSON(path.join(MERGED_DIR, 'calendar.json'), {
    count: dailyEntries.length,
    updatedAt: new Date().toISOString(),
    items: dailyEntries,
  });
}

function saveSyncState(semester, courseCount, stats) {
  writeJSON(SYNC_PATH, {
    lastSyncAt: new Date().toISOString(),
    semester: semester ? { id: semester.id, startDate: semester.startDate, endDate: semester.endDate } : null,
    courseCount,
    stats,
  });
}

// ============ 主流程 ============

async function main() {
  log('=== 🎀 小鈴 · 校园数据同步 ===\n');

  // 1. 读配置
  const config = readJSON(CONFIG_PATH);
  if (!config || !config.username || !config.password) {
    log('❌ 未配置认证信息。请编辑 config.json 填写学号密码。');
    log(`   ${CONFIG_PATH}`);
    process.exit(1);
  }

  log(`📋 用户: ${config.username}`);
  log(`📋 模式: ${config.graduate ? '研究生' : '本科生'}`);
  if (DRY_RUN) log('🏃 模拟运行（不写文件）');
  log('');

  // 2. 初始化 & Cookie 恢复
  mkdirp(COURSES_DIR);
  mkdirp(CAL_DAILY_DIR);
  mkdirp(CAL_MONTHLY_DIR);
  mkdirp(MERGED_DIR);

  // 尝试从浏览器会话恢复 Cookie
  const COOKIE_PATH = path.join(CAMPUS_DIR, '_cookies.json');
  let savedCookies = {};
  if (fs.existsSync(COOKIE_PATH)) {
    savedCookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'));
    if (Object.keys(savedCookies).length > 0) {
      debug(`  🍪 发现 ${Object.keys(savedCookies).length} 个已保存的 Cookie`);
      
      // 在 global fetch 层面强行注入 cookie
      // thu-learn-lib 内部有自己的 cookie jar（会覆盖 Header），
      // 所以咱要在它设置之后、实际发送请求之前覆盖
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async function(input, init) {
        const urlStr = typeof input === 'string' ? input 
          : (input instanceof URL ? input.href : input.url);
        
        if (urlStr.includes('tsinghua.edu.cn')) {
          const headers = new Headers(init?.headers || {});
          // 直接用咱保存的 cookie 覆盖，不怕 thu-learn-lib 的 jar 是空的
          const cookieStr = Object.entries(savedCookies)
            .map(([k, v]) => `${k}=${v}`).join('; ');
          headers.set('Cookie', cookieStr);
          init = { ...init, headers };
        }
        return originalFetch.call(this, input, init);
      };
      
      debug('  ✅ Cookie 注入完成');
    }
  }

  const helper = new Learn2018Helper();

  // 3. 登录
  log('🔑 正在登录...');
  if (!config.fingerPrint) {
    log('❌ 缺少设备指纹（fingerPrint），请先运行:');
    log(`    node ${path.join(CAMPUS_DIR, 'scripts', 'login.js')}`);
    process.exit(1);
  }

  try {
    await helper.login(
      config.username,
      config.password,
      config.fingerPrint,
      config.fingerGenPrint || '',
      config.fingerGenPrint3 || '',
    );
    log('✅ 登录成功');
  } catch (err) {
    log(`❌ 登录失败: ${err.message}`);
    if (err.reason) {
      if (err.reason === 'double authentication required') {
        log('');
        log('  提示：需要二次认证。请运行 login.js 完成一次交互登录：');
        log(`    node ${path.join(CAMPUS_DIR, 'scripts', 'login.js')}`);
      } else {
        log(`   原因: ${err.reason}`);
      }
    }
    process.exit(1);
  }

  // 4. 获取学期信息
  log('\n📚 获取学期信息...');
  let semester, semesters;
  try {
    semesters = await helper.getSemesterIdList();
    log(`  学期列表: ${semesters.join(', ')}`);
    semester = await helper.getCurrentSemester();
    log(`  当前学期: ${semester.id} (${dayjs(semester.startDate).format('YYYY-MM-DD')} ~ ${dayjs(semester.endDate).format('YYYY-MM-DD')})`);
    writeJSON(path.join(DATA_DIR, 'semesters.json'), semesters);
    writeJSON(path.join(DATA_DIR, 'current.json'), semester);
  } catch (err) {
    log(`❌ 获取学期信息失败: ${err.message}`);
    process.exit(1);
  }

  // 5. 获取课程列表
  log('\n📖 获取课程列表...');
  let courses;
  try {
    courses = await helper.getCourseList(semester.id);
    log(`  课程数: ${courses.length}`);
    for (const c of courses) {
      log(`    - ${c.name} (${c.teacherName})`);
    }
    writeJSON(path.join(COURSES_DIR, 'index.json'), {
      semesterId: semester.id,
      count: courses.length,
      items: courses.map(c => ({ id: c.id, name: c.name, teacherName: c.teacherName })),
    });
  } catch (err) {
    log(`❌ 获取课程列表失败: ${err.message}`);
    process.exit(1);
  }

  const courseIds = courses.map(c => c.id);

  // 6. 获取日历事件
  log('\n📅 获取课表日历...');
  let apiEvents = [];
  try {
    const dateFormat = 'YYYYMMDD';
    const startStr = dayjs(semester.startDate).format(dateFormat);
    const endStr = dayjs(semester.endDate).format(dateFormat);
    apiEvents = await helper.getCalendar(startStr, endStr, config.graduate);
    log(`  日历事件数: ${apiEvents.length}`);
    if (VERBOSE) {
      for (const ev of apiEvents.slice(0, 5)) {
        log(`    - ${ev.courseName} ${ev.date} ${ev.startTime}-${ev.endTime} @${ev.location}`);
      }
      if (apiEvents.length > 5) log(`    ... 还有 ${apiEvents.length - 5} 条`);
    }
  } catch (err) {
    log(`⚠️  获取日历事件失败: ${err.message}，使用排课解析代替`);
  }

  // 建立课程名→ID映射
  const courseNameToId = {};
  for (const c of courses) {
    courseNameToId[c.name] = c.id;
    courseNameToId[c.chineseName] = c.id;
  }

  // 7. 获取所有内容（作业+通知+文件）
  log('\n📋 正在拉取各课程内容...');

  let allAssignments = [];
  let allNotifications = [];
  let allFiles = [];

  try {
    log('  ⏳ 作业...');
    const homeworkByCourse = await helper.getAllContents(courseIds, ContentType.HOMEWORK);
    for (const [courseId, items] of Object.entries(homeworkByCourse)) {
      const course = courses.find(c => c.id === courseId);
      const enriched = items.map(item => ({
        ...item,
        courseId,
        courseName: course ? course.name : '未知课程',
      }));
      allAssignments.push(...enriched);
    }
    log(`    ✅ ${allAssignments.length} 条作业`);

    log('  ⏳ 通知...');
    const noticesByCourse = await helper.getAllContents(courseIds, ContentType.NOTIFICATION);
    for (const [courseId, items] of Object.entries(noticesByCourse)) {
      const course = courses.find(c => c.id === courseId);
      const enriched = items.map(item => ({
        ...item,
        courseId,
        courseName: course ? course.name : '未知课程',
      }));
      allNotifications.push(...enriched);
    }
    log(`    ✅ ${allNotifications.length} 条通知`);

    log('  ⏳ 文件...');
    const filesByCourse = await helper.getAllContents(courseIds, ContentType.FILE);
    for (const [courseId, items] of Object.entries(filesByCourse)) {
      const course = courses.find(c => c.id === courseId);
      const enriched = items.map(item => ({
        ...item,
        courseId,
        courseName: course ? course.name : '未知课程',
      }));
      allFiles.push(...enriched);
    }
    log(`    ✅ ${allFiles.length} 个文件`);
  } catch (err) {
    log(`  ⚠️  批量拉取失败: ${err.message}，尝试逐个课程拉取...`);

    // 逐个课程拉取
    for (const course of courses) {
      try {
        debug(`  [${course.name}] 拉取作业...`);
        const hw = await helper.getHomeworkList(course.id);
        const enriched = hw.map(item => ({ ...item, courseId: course.id, courseName: course.name }));
        allAssignments.push(...enriched);
      } catch (e) { debug(`    ⚠️  作业拉取失败: ${e.message}`); }

      try {
        debug(`  [${course.name}] 拉取通知...`);
        const nt = await helper.getNotificationList(course.id);
        const enriched = nt.map(item => ({ ...item, courseId: course.id, courseName: course.name }));
        allNotifications.push(...enriched);
      } catch (e) { debug(`    ⚠️  通知拉取失败: ${e.message}`); }

      try {
        debug(`  [${course.name}] 拉取文件...`);
        const fl = await helper.getFileList(course.id);
        const enriched = fl.map(item => ({ ...item, courseId: course.id, courseName: course.name }));
        allFiles.push(...enriched);
      } catch (e) { debug(`    ⚠️  文件拉取失败: ${e.message}`); }
    }
    log(`    ✅ ${allAssignments.length} 条作业, ${allNotifications.length} 条通知, ${allFiles.length} 个文件`);
  }

  // 8. 解析排课
  log('\n🏗️  构建日历数据结构...');
  const schedules = {};
  for (const course of courses) {
    schedules[course.id] = expandSchedule(course, semester.startDate, semester.endDate);
    debug(`  [${course.name}] ${schedules[course.id].length} 个排课槽`);
  }

  // 9. 构建日历条目
  let dailyEntries = [];

  // 优先使用API返回的精确日历事件
  if (apiEvents.length > 0) {
    dailyEntries.push(...buildAPICalendarEntries(apiEvents, courseNameToId));
    log(`  ✅ 使用API日历: ${apiEvents.length} 条课程事件`);
  } else {
    // 回退到排课解析
    const scheduleEntries = buildCourseCalendarEntries(courses, schedules, semester.startDate);
    dailyEntries.push(...scheduleEntries);
    log(`  ✅ 使用排课解析: ${scheduleEntries.length} 条课程事件`);
  }

  // 添加作业截止日期
  const asgnEntries = buildAssignmentCalendarEntries(allAssignments);
  dailyEntries.push(...asgnEntries);
  log(`  ✅ 添加作业截止: ${asgnEntries.length} 条`);

  // 按日期排序
  dailyEntries.sort((a, b) => a.date.localeCompare(b.date));

  // 10. 保存数据
  log('\n💾 保存数据...');

  // 按课程保存
  for (const course of courses) {
    const courseAssignments = allAssignments.filter(a => a.courseId === course.id);
    const courseNotices = allNotifications.filter(n => n.courseId === course.id);
    const courseFiles = allFiles.filter(f => f.courseId === course.id);
    saveCourseData(course, schedules[course.id], courseAssignments, courseNotices, courseFiles);
  }
  log('  ✅ 课程数据已保存');

  saveCalendarData(dailyEntries, allAssignments);
  log('  ✅ 日历数据已保存');

  saveMergedViews(allAssignments, allNotifications, allFiles, dailyEntries);
  log('  ✅ 汇总数据已保存');

  // 11. 保存同步状态
  const stats = {
    courses: courses.length,
    calendarEvents: apiEvents.length,
    assignments: allAssignments.length,
    notifications: allNotifications.length,
    files: allFiles.length,
    calendarEntries: dailyEntries.length,
  };
  saveSyncState(semester, courses.length, stats);

  // 12. 输出摘要
  log('\n' + '='.repeat(45));
  log('📊 同步完成摘要');
  log('='.repeat(45));
  log(`  学期:     ${semester.id}`);
  log(`  课程:     ${stats.courses}`);
  log(`  日历事件: ${stats.calendarEvents}`);
  log(`  作业:     ${stats.assignments}`);
  log(`  通知:     ${stats.notifications}`);
  log(`  文件:     ${stats.files}`);
  log(`  日历条目: ${stats.calendarEntries}`);
  log(`  时间:     ${new Date().toLocaleString('zh-CN')}`);
  log('='.repeat(45));
  log('🎀 小鈴随时帮您查询校园信息~\n');
}

main().catch(err => {
  log(`\n❌ 同步失败: ${err.message}`);
  if (VERBOSE) console.error(err);
  process.exit(1);
});
