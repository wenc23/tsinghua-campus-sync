# 🏫 校园数据仓库 - 数据模型文档

> 从清华网络学堂 API 拉取的课程、课表、作业、通知、文件的统一存储结构。
> 由 thu-learn-lib 驱动，按课程组织，以日历为核心索引。

---

## 目录结构

```
~/suzu_storage/campus/
├── config.json              # 认证信息（学号密码，本地存储）
├── _sync.json               # 同步状态（最后同步时间、学期、课程数）
├── _schema.md               # 本文件
│
├── semesters.json           # 所有学期列表
├── current.json             # 当前学期信息
│
├── courses/
│   ├── index.json           # 所有课程索引
│   └── {course_id}/
│       ├── info.json        # 课程基本信息
│       ├── schedule.json    # 解析后的课程排课（周次/节次/地点）
│       ├── assignments.json # 作业列表
│       ├── notifications.json # 通知/公告
│       └── files.json       # 课程文件/资料
│
├── calendar/
│   ├── index.json           # 日历索引
│   ├── daily/
│   │   └── 2026-04-28.json  # 单日课表（课程 + 作业截止）
│   └── monthly/
│       └── 2026-04.json     # 月度概览
│
└── merged/
    ├── assignments.json     # 全课程作业汇总（按截止时间排序）
    ├── notifications.json   # 全课程通知汇总（按时间排序）
    ├── files.json           # 全课程文件汇总（按上传时间排序）
    └── calendar.json        # 统一日历索引（合并课表+作业截止）
```

---

## 数据结构

### CalendarEntry（日历条目 - 核心模型）

每条日历条目代表某一天的一个时间块，可能是课程、考试或作业截止。

```json
{
  "id": "unique-string",
  "type": "course | assignment",
  "date": "2026-04-28",
  "dayOfWeek": 1,
  "title": "课程/作业名称",
  "courseId": "semester-xxxxxxxxx",
  "courseName": "数字系统设计",
  "startTime": "08:00",
  "endTime": "09:35",
  "location": "六教6A414",
  "status": "",
  "weekNumber": 9,
  "description": ""
}
```

作业截止作为日历条目时，startTime/endTime 可空，仅 date 生效。

### Course（课程）

```json
{
  "id": "semester-xxxxxxxxx",
  "name": "数字系统设计",
  "chineseName": "数字系统设计",
  "englishName": "Digital System Design",
  "teacherName": "刘勇攀",
  "teacherNumber": "2001990049",
  "courseNumber": "40230810",
  "semesterId": "2025-2026-2",
  "timeAndLocation": ["星期六第1节(9,11周)，六教6A414", ...]
}
```

### ScheduleSlot（排课槽 - 从 timeAndLocation 解析）

```json
{
  "dayOfWeek": 6,
  "startPeriod": 1,
  "endPeriod": 2,
  "startTime": "08:00",
  "endTime": "09:35",
  "weeks": [9, 10, 11],
  "location": "六教6A414",
  "locationShort": "六教"
}
```

### Assignment（作业）

```json
{
  "id": "hex-id",
  "title": "第一次大作业",
  "description": "要求见附件",
  "deadline": "2026-05-15T23:59:00",
  "submitted": false,
  "graded": false,
  "grade": null,
  "gradeLevel": null,
  "courseId": "semester-xxxxxxxxx",
  "courseName": "数字系统设计",
  "hasAttachment": true,
  "attachmentName": "大作业说明.pdf"
}
```

### Notification（通知）

```json
{
  "id": "hex-id",
  "title": "调课通知",
  "content": "下周三课程改为线上进行...",
  "publisher": "刘勇攀",
  "publishTime": "2026-04-20T10:00:00",
  "hasRead": false,
  "markedImportant": true,
  "courseId": "semester-xxxxxxxxx",
  "courseName": "数字系统设计",
  "hasAttachment": false
}
```

### File（文件）

```json
{
  "id": "file-id",
  "title": "第9周课件",
  "description": "包含本周教学内容",
  "uploadTime": "2026-04-21T14:00:00",
  "size": "2.5MB",
  "fileType": "pdf",
  "downloadUrl": "https://...",
  "isNew": true,
  "courseId": "semester-xxxxxxxxx",
  "courseName": "数字系统设计"
}
```

---

## 数据结构关系图

```
学期(semester)
  └── 课程列表(courses)
        ├── 基本信息(info)
        ├── 排课(schedule)  ──→  日历条目(CalendarEntry, type=course)
        ├── 作业(assignments)  ──→  日历条目(CalendarEntry, type=assignment)
        ├── 通知(notifications)
        └── 文件(files)
```

---

## 查询接口

通过校园数据仓库，可以回答这些常见问题：

- 📅 "今天有什么课？" → 读 daily/{date}.json
- 📋 "这周的作业" → 读 calendar/daily/week 汇总
- ⏰ "即将截止的作业" → 读 merged/assignments.json 过滤
- 📢 "有没有新通知？" → 读 merged/notifications.json
- 📁 "XX课的课件在哪" → 读 courses/{id}/files.json
- 🎯 "期末什么时候" → current.json
