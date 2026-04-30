#!/usr/bin/env node
/**
 * 清华校园数据 — MCP Server
 *
 * 通过 stdio 协议暴露课程/作业/通知/文件查询工具。
 * 数据从本地缓存的 JSON 文件读取（由 fetch.js 生成）。
 *
 * 配置方法（~/.hermes/config.yaml）：
 *   mcp_servers:
 *     campus:
 *       command: "node"
 *       args: ["~/suzu_storage/campus/scripts/mcp-server.js"]
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const dayjs = require('dayjs');

const CAMPUS_DIR = path.resolve(__dirname, '..');
const COURSES_DIR = path.join(CAMPUS_DIR, 'courses');
const CAL_DAILY_DIR = path.join(CAMPUS_DIR, 'calendar/daily');
const MERGED_DIR = path.join(CAMPUS_DIR, 'merged');
const SYNC_PATH = path.join(CAMPUS_DIR, '_sync.json');

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAY_NAMES_CN = ['日', '一', '二', '三', '四', '五', '六'];

// ========== 工具函数 ==========

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return null; }
}

function readDaily(dateStr) {
  return readJSON(path.join(CAL_DAILY_DIR, `${dateStr}.json`));
}

function getTodayStr() { return dayjs().format('YYYY-MM-DD'); }
function getWeekBoundary() {
  const n = dayjs();
  return { start: n.day(0).format('YYYY-MM-DD'), end: n.add(6, 'day').format('YYYY-MM-DD') };
}

function listCourses() {
  const idx = readJSON(path.join(COURSES_DIR, 'index.json'));
  return idx ? idx.items : [];
}

// ========== 工具实现 ==========

function toolToday(args) {
  const dateStr = args?.date || getTodayStr();
  const data = readDaily(dateStr);
  if (!data || !data.entries || data.entries.length === 0) {
    return { empty: true, date: dateStr, dayOfWeek: DAY_NAMES[dayjs(dateStr).day()], courses: [], assignments: [] };
  }
  return {
    date: dateStr,
    dayOfWeek: DAY_NAMES[dayjs(dateStr).day()],
    count: data.entries.length,
    courses: data.entries.filter(e => e.type === 'course').map(e => ({
      title: e.title, courseName: e.courseName,
      startTime: e.startTime, endTime: e.endTime, location: e.location,
    })),
    assignments: data.entries.filter(e => e.type === 'assignment').map(e => ({
      title: e.title.replace('📝 ', ''), courseName: e.courseName,
      deadline: e.deadline, submitted: e.submitted, status: e.status,
    })),
  };
}

function toolWeek(args) {
  const { start, end } = getWeekBoundary();
  const days = [];
  let d = dayjs(start);
  let totalCourses = 0, totalAssignments = 0;
  while (d.isBefore(dayjs(end).add(1, 'day'))) {
    const ds = d.format('YYYY-MM-DD');
    const data = readDaily(ds);
    const courses = data?.entries?.filter(e => e.type === 'course') || [];
    const assignments = data?.entries?.filter(e => e.type === 'assignment') || [];
    totalCourses += courses.length;
    totalAssignments += assignments.length;
    days.push({
      date: ds,
      dayOfWeek: DAY_NAMES[d.day()],
      courses: courses.map(e => ({ title: e.courseName, time: `${e.startTime||''}-${e.endTime||''}`, location: e.location })),
      assignments: assignments.map(e => ({ title: e.title.replace('📝 ', ''), deadline: e.deadline, submitted: e.submitted })),
    });
    d = d.add(1, 'day');
  }
  return { start, end, totalCourses, totalAssignments, days };
}

function toolHomework(args) {
  const data = readJSON(path.join(MERGED_DIR, 'assignments.json'));
  if (!data) return { error: '暂无作业数据，请先运行 sync' };
  const allFlag = args?.all === true;
  const items = allFlag ? data.items : data.items.filter(a => !a.submitted && (!a.deadline || dayjs(a.deadline).isAfter(dayjs())));
  const overdue = data.items.filter(a => !a.submitted && a.deadline && dayjs(a.deadline).isBefore(dayjs()));
  return {
    total: data.count,
    shown: items.length,
    all: allFlag,
    overdueCount: overdue.length,
    overdue: overdue.map(a => ({ title: a.title, courseName: a.courseName, deadline: a.deadline })),
    items: items.map(a => ({
      title: a.title, courseName: a.courseName,
      deadline: a.deadline, submitted: a.submitted, graded: a.graded,
      grade: a.grade, gradeLevel: a.gradeLevel,
      daysLeft: a.deadline ? dayjs(a.deadline).diff(dayjs(), 'day') : null,
    })),
  };
}

function toolUpcoming(args) {
  const data = readJSON(path.join(MERGED_DIR, 'assignments.json'));
  if (!data) return { error: '暂无作业数据' };
  const days = args?.days || 14;
  const now = dayjs();
  const items = data.items
    .filter(a => !a.submitted && a.deadline && dayjs(a.deadline).isAfter(now) && dayjs(a.deadline).diff(now, 'day') <= days)
    .sort((a, b) => dayjs(a.deadline).unix() - dayjs(b.deadline).unix());
  return {
    days, count: items.length,
    items: items.map(a => ({
      title: a.title, courseName: a.courseName,
      deadline: a.deadline,
      daysLeft: dayjs(a.deadline).diff(now, 'day'),
      hoursLeft: dayjs(a.deadline).diff(now, 'hour') % 24,
      urgent: dayjs(a.deadline).diff(now, 'day') <= 3,
    })),
  };
}

function toolCourseInfo(args) {
  const keyword = args?.keyword || '';
  const courses = listCourses();
  const matches = courses.filter(c =>
    c.name.includes(keyword) || c.id.includes(keyword) || (c.teacherName && c.teacherName.includes(keyword))
  );
  if (matches.length === 0) return { found: false, keyword };
  return {
    found: true,
    keyword,
    courses: matches.map(mc => {
      const dir = path.join(COURSES_DIR, mc.id);
      const info = readJSON(path.join(dir, 'info.json'));
      const notifications = readJSON(path.join(dir, 'notifications.json'));
      const files = readJSON(path.join(dir, 'files.json'));
      return {
        id: mc.id,
        name: mc.name,
        teacherName: mc.teacherName,
        courseNumber: info?.courseNumber || null,
        notifications: notifications ? {
          count: notifications.count,
          recent: notifications.items.slice(0, 5).map(n => ({
            title: n.title, publishTime: n.publishTime,
            markedImportant: n.markedImportant, unread: n.hasRead === false,
          })),
        } : null,
        files: files ? {
          count: files.count,
          recent: files.items.slice(0, 5).map(f => ({
            title: f.title, size: f.size, uploadTime: f.uploadTime, isNew: f.isNew,
          })),
        } : null,
      };
    }),
  };
}

function toolNotifications(args) {
  const data = readJSON(path.join(MERGED_DIR, 'notifications.json'));
  if (!data) return { error: '暂无通知数据' };
  const limit = args?.limit || 20;
  return {
    total: data.count,
    unread: data.items.filter(n => n.hasRead === false).length,
    items: data.items.slice(0, limit).map(n => ({
      title: n.title, courseName: n.courseName,
      publishTime: n.publishTime, hasRead: n.hasRead,
      markedImportant: n.markedImportant, publisher: n.publisher,
    })),
  };
}

function toolFiles(args) {
  const data = readJSON(path.join(MERGED_DIR, 'files.json'));
  if (!data) return { error: '暂无文件数据' };
  const limit = args?.limit || 20;
  return {
    total: data.count,
    newFiles: data.items.filter(f => f.isNew).length,
    items: data.items.slice(0, limit).map(f => ({
      title: f.title, courseName: f.courseName,
      size: f.size, uploadTime: f.uploadTime, fileType: f.fileType,
      isNew: f.isNew, downloadUrl: f.downloadUrl,
    })),
  };
}

function toolStats() {
  const sync = readJSON(SYNC_PATH);
  if (!sync) return { synced: false };
  const hoursAgo = dayjs().diff(dayjs(sync.lastSyncAt), 'hour');
  const courses = listCourses();
  return {
    synced: true,
    semester: sync.semester,
    courseCount: sync.courseCount,
    lastSyncAt: sync.lastSyncAt,
    hoursAgo,
    stats: sync.stats || {},
    courses: courses.map(c => ({ name: c.name, teacherName: c.teacherName })),
  };
}

function toolSync(args) {
  try {
    const scriptPath = path.join(CAMPUS_DIR, 'scripts', 'fetch.js');
    if (!fs.existsSync(scriptPath)) return { error: `fetch.js not found at ${scriptPath}` };
    const verbose = args?.verbose === true;
    const cmd = `node "${scriptPath}"${verbose ? ' --verbose' : ''}`;
    const output = execSync(cmd, { cwd: path.join(CAMPUS_DIR, 'scripts'), timeout: 120000, encoding: 'utf-8' });
    const lines = output.trim().split('\n');
    const summary = lines.filter(l => l.includes('同步完成摘要') || l.includes('日历事件:') || l.includes('作业:') || l.includes('课程:'));
    return { success: true, output: summary.join('\n') };
  } catch (err) {
    return { success: false, error: err.message, stderr: err.stderr?.toString().slice(0, 500) };
  }
}

const TOOLS = {
  today: {
    description: '查询某天的课表和作业截止。默认今天。参数: date (可选, YYYY-MM-DD)',
    handler: toolToday,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
      },
    },
  },
  week: {
    description: '查询本周完整课表和作业安排',
    handler: toolWeek,
    inputSchema: { type: 'object', properties: {} },
  },
  homework: {
    description: '查询作业列表。默认只看未提交+未过期。参数: all (可选, true=全部)',
    handler: toolHomework,
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: '设为 true 查看全部作业' },
      },
    },
  },
  upcoming: {
    description: '查询未来 N 天内即将截止的作业。参数: days (可选, 默认14)',
    handler: toolUpcoming,
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '天数范围，默认14' },
      },
    },
  },
  course: {
    description: '按名称/教师查询课程详细信息（含通知和文件）。参数: keyword (必填)',
    handler: toolCourseInfo,
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '课程名称或教师名关键词' },
      },
      required: ['keyword'],
    },
  },
  notifications: {
    description: '查询最近通知。参数: limit (可选, 默认20)',
    handler: toolNotifications,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认20' },
      },
    },
  },
  files: {
    description: '查询最近课程文件。参数: limit (可选, 默认20)',
    handler: toolFiles,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认20' },
      },
    },
  },
  stats: {
    description: '查看数据同步概览（学期、课程数、最近同步时间）',
    handler: toolStats,
    inputSchema: { type: 'object', properties: {} },
  },
  sync: {
    description: '触发一次全量数据同步（运行 fetch.js）。参数: verbose (可选)',
    handler: toolSync,
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: '输出详细日志' },
      },
    },
  },
};

// ========== MCP Server ==========

const server = new Server(
  { name: 'tsinghua-campus-sync', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS[name];
  if (!tool) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `未知工具: ${name}` }) }], isError: true };
  }
  try {
    const result = tool.handler(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🏫 Campus MCP Server started (stdio)');
}

main().catch(err => {
  console.error('MCP Server Error:', err.message);
  process.exit(1);
});
