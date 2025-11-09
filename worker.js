// cloudflare-worker.js - 完整班级评分系统
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 初始化数据库
      await initDatabase(env.DB);

      // API路由
      if (path.startsWith('/api/')) {
        return await handleAPI(request, env, url);
      }

      // 页面路由
      return await handlePages(request, env, url);
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: '服务器错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// 初始化数据库
async function initDatabase(db) {
  try {
    // 创建学生表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建评分项表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS score_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        type TEXT,
        weight INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建评分记录表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS score_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        category_id INTEGER,
        score INTEGER,
        operator TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students (id),
        FOREIGN KEY (category_id) REFERENCES score_categories (id)
      )
    `);

    // 创建任务表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        deadline DATETIME,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建系统设置表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建月度快照表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS monthly_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT,
        student_name TEXT,
        add_score INTEGER,
        minus_score INTEGER,
        total_score INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建操作日志表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        action_type TEXT,
        score_change INTEGER,
        operator TEXT,
        category_name TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 初始化默认设置
    const defaultSettings = [
      ['class_username', '2314'],
      ['class_password', 'hzwy2314'],
      ['admin_username', '2314admin'],
      ['admin_password', '2314admin2314admin'],
      ['site_title', '2314班综合评分系统'],
      ['class_name', '2314班'],
      ['current_month', new Date().toISOString().slice(0, 7)]
    ];

    for (const [key, value] of defaultSettings) {
      await db.prepare(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
      ).bind(key, value).run();
    }

    // 初始化学生数据
    const students = [
      '曾钰景', '陈金语', '陈金卓', '陈明英', '陈兴旺', '陈钰琳', '代紫涵', '丁玉文',
      '高建航', '高奇', '高思凡', '高兴扬', '关戎', '胡菡', '胡人溪', '胡延鑫',
      '胡意佳', '胡语欣', '李国华', '李昊蓉', '李浩', '李灵芯', '李荣蝶', '李鑫蓉',
      '廖聪斌', '刘沁熙', '刘屹', '孟舒玲', '孟卫佳', '庞清清', '任雲川', '邵金平',
      '宋毓佳', '唐旺', '唐正高', '王恒', '王文琪', '吴良涛', '吴永贵', '夏碧涛',
      '徐程', '徐海俊', '徐小龙', '颜荣蕊', '晏灏', '杨青望', '余芳', '张灿',
      '张航', '张杰', '张毅', '赵丽瑞', '赵美婷', '赵威', '周安融', '周思棋', '朱蕊'
    ];

    for (const name of students) {
      await db.prepare(
        'INSERT OR IGNORE INTO students (name) VALUES (?)'
      ).bind(name).run();
    }

    // 初始化评分类别
    const scoreCategories = [
      // 加分项
      ['作业完成质量优秀', 'add', 2],
      ['天天练达标', 'add', 1],
      ['准时上课', 'add', 1],
      ['卫生完成优秀', 'add', 2],
      ['行为习惯良好', 'add', 2],
      ['早操出勤', 'add', 1],
      ['上课专注', 'add', 2],
      ['任务完成优秀', 'add', 3],
      ['课堂表现积极', 'add', 2],
      ['帮助同学', 'add', 3],
      
      // 减分项
      ['上课违纪', 'minus', 2],
      ['作业完成质量差', 'minus', 2],
      ['天天练未达标', 'minus', 1],
      ['迟到', 'minus', 1],
      ['卫生未完成', 'minus', 2],
      ['行为习惯差', 'minus', 2],
      ['早操缺勤', 'minus', 1],
      ['上课不专注', 'minus', 2],
      ['未交/拖延作业', 'minus', 3],
      ['破坏课堂纪律', 'minus', 3]
    ];

    for (const [name, type, weight] of scoreCategories) {
      await db.prepare(
        'INSERT OR IGNORE INTO score_categories (name, type, weight) VALUES (?, ?, ?)'
      ).bind(name, type, weight).run();
    }

  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// API处理
async function handleAPI(request, env, url) {
  const path = url.pathname;

  try {
    if (path === '/api/login') {
      return await handleLogin(request, env);
    } else if (path === '/api/logout') {
      return handleLogout();
    } else if (path === '/api/students') {
      return await handleGetStudents(env.DB);
    } else if (path === '/api/score') {
      return await handleAddScore(request, env.DB);
    } else if (path === '/api/revoke') {
      return await handleRevokeScore(request, env.DB);
    } else if (path === '/api/tasks') {
      if (request.method === 'GET') {
        return await handleGetTasks(env.DB);
      } else if (request.method === 'POST') {
        return await handleAddTask(request, env.DB);
      } else if (request.method === 'DELETE') {
        return await handleDeleteTask(request, env.DB);
      }
    } else if (path === '/api/snapshot') {
      return await handleSnapshot(request, env.DB);
    } else if (path === '/api/reset') {
      return await handleReset(request, env.DB);
    } else if (path === '/api/settings') {
      if (request.method === 'GET') {
        return await handleGetSettings(env.DB);
      } else if (request.method === 'POST') {
        return await handleUpdateSettings(request, env.DB);
      }
    } else if (path === '/api/logs') {
      return await handleGetLogs(request, env.DB);
    } else if (path === '/api/monthly') {
      return await handleGetMonthlyData(request, env.DB);
    }

    return new Response('Not Found', { status: 404 });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: 'API错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 登录处理
async function handleLogin(request, env) {
  const { username, password } = await request.json();
  
  const settings = await env.DB.prepare(
    'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)'
  ).bind('class_username', 'class_password', 'admin_username', 'admin_password').all();

  const settingMap = {};
  settings.results.forEach(row => {
    settingMap[row.key] = row.value;
  });

  let role = '';
  if (username === settingMap.class_username && password === settingMap.class_password) {
    role = 'class';
  } else if (username === settingMap.admin_username && password === settingMap.admin_password) {
    role = 'admin';
  }

  if (role) {
    const sessionId = generateSessionId();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const cookie = `session=${sessionId}; Path=/; HttpOnly; Expires=${expires.toUTCString()}; SameSite=Lax`;
    
    // 存储会话信息
    await env.DB.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).bind(`session_${sessionId}`, JSON.stringify({ username, role, expires: expires.getTime() })).run();
    
    return new Response(JSON.stringify({ success: true, role }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie
      }
    });
  }

  return new Response(JSON.stringify({ success: false, error: '用户名或密码错误' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 登出处理
async function handleLogout() {
  const cookie = 'session=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie
    }
  });
}

// 获取学生数据
async function handleGetStudents(db) {
  const students = await db.prepare(`
    SELECT s.id, s.name, 
           COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
           COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
           COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
    FROM students s
    LEFT JOIN score_records sr ON s.id = sr.student_id
    LEFT JOIN score_categories sc ON sr.category_id = sc.id
    GROUP BY s.id, s.name
    ORDER BY total_score DESC
  `).all();

  const addRankings = [...students.results]
    .map(s => ({ ...s, score: s.add_score }))
    .sort((a, b) => b.score - a.score);
  
  const minusRankings = [...students.results]
    .map(s => ({ ...s, score: s.minus_score }))
    .sort((a, b) => b.score - a.score);

  return new Response(JSON.stringify({
    students: students.results,
    addRankings: addRankings.slice(0, 10),
    minusRankings: minusRankings.slice(0, 10)
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}

// 添加分数
async function handleAddScore(request, db) {
  const { studentId, categoryId, score, operator, note } = await request.json();
  
  // 获取类别信息
  const category = await db.prepare(
    'SELECT name, type FROM score_categories WHERE id = ?'
  ).bind(categoryId).first();
  
  if (!category) {
    return new Response(JSON.stringify({ success: false, error: '评分项目不存在' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 插入评分记录
  await db.prepare(
    'INSERT INTO score_records (student_id, category_id, score, operator, note) VALUES (?, ?, ?, ?, ?)'
  ).bind(studentId, categoryId, score, operator, note).run();

  // 记录操作日志
  await db.prepare(
    'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(studentId, category.type, category.type === 'add' ? score : -score, operator, category.name, note).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 撤销操作
async function handleRevokeScore(request, db) {
  const { studentId } = await request.json();
  
  // 获取最近一条记录
  const lastRecord = await db.prepare(`
    SELECT sr.id, sr.score, sc.type, sc.name as category_name, sr.operator, sr.note
    FROM score_records sr
    JOIN score_categories sc ON sr.category_id = sc.id
    WHERE sr.student_id = ?
    ORDER BY sr.created_at DESC 
    LIMIT 1
  `).bind(studentId).first();

  if (!lastRecord) {
    return new Response(JSON.stringify({ success: false, error: '没有可撤销的记录' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 删除记录
  await db.prepare('DELETE FROM score_records WHERE id = ?').bind(lastRecord.id).run();

  // 记录撤销日志
  await db.prepare(
    'INSERT INTO operation_logs (student_id, action_type, score_change, operator, category_name, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(studentId, 'revoke', lastRecord.type === 'add' ? -lastRecord.score : lastRecord.score, 
         lastRecord.operator, `撤销: ${lastRecord.category_name}`, '撤销操作').run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取任务
async function handleGetTasks(db) {
  const tasks = await db.prepare(
    'SELECT * FROM tasks ORDER BY created_at DESC'
  ).all();

  return new Response(JSON.stringify(tasks.results), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 添加任务
async function handleAddTask(request, db) {
  const { title, content, deadline, created_by } = await request.json();
  
  await db.prepare(
    'INSERT INTO tasks (title, content, deadline, created_by) VALUES (?, ?, ?, ?)'
  ).bind(title, content, deadline, created_by).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 删除任务
async function handleDeleteTask(request, db) {
  const { id } = await request.json();
  
  await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 创建快照
async function handleSnapshot(request, db) {
  const { month, title } = await request.json();
  
  // 获取当前所有学生分数
  const students = await db.prepare(`
    SELECT s.name, 
           COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE 0 END), 0) as add_score,
           COALESCE(SUM(CASE WHEN sc.type = 'minus' THEN sr.score ELSE 0 END), 0) as minus_score,
           COALESCE(SUM(CASE WHEN sc.type = 'add' THEN sr.score ELSE -sr.score END), 0) as total_score
    FROM students s
    LEFT JOIN score_records sr ON s.id = sr.student_id
    LEFT JOIN score_categories sc ON sr.category_id = sc.id
    GROUP BY s.id, s.name
  `).all();

  // 保存快照
  for (const student of students.results) {
    await db.prepare(
      'INSERT INTO monthly_snapshots (month, student_name, add_score, minus_score, total_score) VALUES (?, ?, ?, ?, ?)'
    ).bind(`${month}-${title}`, student.name, student.add_score, student.minus_score, student.total_score).run();
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 重置分数
async function handleReset(request, db) {
  await db.prepare('DELETE FROM score_records').run();
  await db.prepare('DELETE FROM operation_logs').run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取设置
async function handleGetSettings(db) {
  const settings = await db.prepare('SELECT key, value FROM settings').all();
  const settingMap = {};
  settings.results.forEach(row => {
    settingMap[row.key] = row.value;
  });
  
  return new Response(JSON.stringify(settingMap), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 更新设置
async function handleUpdateSettings(request, db) {
  const settings = await request.json();
  
  for (const [key, value] of Object.entries(settings)) {
    await db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).bind(key, value).run();
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取操作日志
async function handleGetLogs(request, db) {
  const { studentId } = Object.fromEntries(new URL(request.url).searchParams);
  
  let query = `
    SELECT ol.*, s.name as student_name 
    FROM operation_logs ol
    JOIN students s ON ol.student_id = s.id
  `;
  let params = [];

  if (studentId) {
    query += ' WHERE ol.student_id = ?';
    params.push(studentId);
  }

  query += ' ORDER BY ol.created_at DESC LIMIT 100';

  const logs = await db.prepare(query).bind(...params).all();

  return new Response(JSON.stringify(logs.results), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 获取月度数据
async function handleGetMonthlyData(request, db) {
  const months = await db.prepare(
    'SELECT DISTINCT month FROM monthly_snapshots ORDER BY month DESC'
  ).all();

  return new Response(JSON.stringify(months.results.map(m => m.month)), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 页面处理
async function handlePages(request, env, url) {
  const path = url.pathname;
  
  try {
    if (path === '/login') {
      return renderLoginPage();
    } else if (path === '/class') {
      return await renderClassPage(env.DB);
    } else if (path === '/admin') {
      return await renderAdminPage(env.DB);
    } else if (path === '/') {
      return await renderVisitorPage(env.DB);
    } else if (path === '/logs') {
      return await renderLogsPage(env.DB, url);
    }

    return renderLoginPage();
  } catch (error) {
    console.error('Page render error:', error);
    return new Response('页面渲染错误', { status: 500 });
  }
}

// 生成会话ID
function generateSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('') + Date.now().toString(36);
}

// 验证会话
async function validateSession(request, db) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('='))
  );
  
  const sessionId = cookies.session;
  if (!sessionId) return null;

  const sessionData = await db.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind(`session_${sessionId}`).first();

  if (!sessionData) return null;

  try {
    const session = JSON.parse(sessionData.value);
    if (session.expires < Date.now()) {
      await db.prepare('DELETE FROM settings WHERE key = ?').bind(`session_${sessionId}`).run();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

// 渲染登录页面
function renderLoginPage() {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>班级评分系统 - 登录</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        
        body { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding: 1rem;
        }
        
        .login-container {
            background: var(--surface); 
            padding: 3rem; 
            border-radius: 24px;
            box-shadow: var(--shadow); 
            width: 100%; 
            max-width: 440px;
            transform: translateY(0); 
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        
        .login-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .login-container:hover { 
            transform: translateY(-8px); 
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        h1 { 
            text-align: center; 
            margin-bottom: 2rem; 
            color: var(--text); 
            font-weight: 700;
            font-size: 2rem;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .input-group { 
            margin-bottom: 1.5rem; 
            position: relative;
        }
        
        input { 
            width: 100%; 
            padding: 1rem 1rem 1rem 3rem; 
            border: 2px solid var(--border); 
            border-radius: 12px; 
            font-size: 1rem; 
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        input:focus { 
            outline: none; 
            border-color: var(--primary); 
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); 
            transform: translateY(-2px);
        }
        
        .input-icon {
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-light);
            transition: color 0.3s ease;
        }
        
        input:focus + .input-icon {
            color: var(--primary);
        }
        
        button { 
            width: 100%; 
            padding: 1rem; 
            background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
            color: white; 
            border: none; 
            border-radius: 12px; 
            font-size: 1rem; 
            font-weight: 600;
            cursor: pointer; 
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        button:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .role-select { 
            display: flex; 
            gap: 0.75rem; 
            margin-bottom: 2rem; 
            background: var(--background);
            padding: 0.5rem;
            border-radius: 12px;
        }
        
        .role-btn { 
            flex: 1; 
            padding: 0.8rem; 
            border: 2px solid transparent; 
            background: transparent; 
            border-radius: 8px; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            text-align: center;
            font-weight: 500;
            color: var(--text-light);
        }
        
        .role-btn.active { 
            background: var(--surface); 
            border-color: var(--primary);
            color: var(--primary);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
        }
        
        .login-info {
            margin-top: 1.5rem;
            padding: 1rem;
            background: var(--background);
            border-radius: 12px;
            font-size: 0.875rem;
            color: var(--text-light);
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }
        
        .info-item:last-child {
            margin-bottom: 0;
        }
        
        @media (max-width: 480px) {
            .login-container {
                padding: 2rem 1.5rem;
            }
            
            h1 {
                font-size: 1.75rem;
            }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>班级评分系统</h1>
        <div class="role-select">
            <div class="role-btn active" data-role="class">班级登录</div>
            <div class="role-btn" data-role="admin">班主任登录</div>
            <div class="role-btn" data-role="visitor">游客登录</div>
        </div>
        <form id="loginForm">
            <div class="input-group">
                <div class="input-icon">👤</div>
                <input type="text" id="username" placeholder="用户名" required>
            </div>
            <div class="input-group">
                <div class="input-icon">🔒</div>
                <input type="password" id="password" placeholder="密码" required>
            </div>
            <button type="submit">登录系统</button>
        </form>
        
        <div class="login-info">
            <div class="info-item">
                <span>班级账号:</span>
                <span>2314 / hzwy2314</span>
            </div>
            <div class="info-item">
                <span>班主任账号:</span>
                <span>2314admin / 2314admin2314admin</span>
            </div>
        </div>
        
        <div id="message" style="margin-top: 1rem; text-align: center; color: var(--danger); font-weight: 500;"></div>
    </div>

    <script>
        let currentRole = 'class';
        const roleCredentials = {
            class: { username: '2314', password: 'hzwy2314' },
            admin: { username: '2314admin', password: '2314admin2314admin' }
        };

        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentRole = btn.dataset.role;
                
                if (currentRole === 'visitor') {
                    window.location.href = '/';
                } else {
                    const creds = roleCredentials[currentRole];
                    document.getElementById('username').value = creds.username;
                    document.getElementById('password').value = creds.password;
                }
            });
        });

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            const submitBtn = e.target.querySelector('button');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '登录中...';
            submitBtn.disabled = true;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const result = await response.json();
                
                if (result.success) {
                    submitBtn.textContent = '登录成功!';
                    setTimeout(() => {
                        if (result.role === 'class') {
                            window.location.href = '/class';
                        } else if (result.role === 'admin') {
                            window.location.href = '/admin';
                        }
                    }, 500);
                } else {
                    document.getElementById('message').textContent = result.error;
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }
            } catch (error) {
                document.getElementById('message').textContent = '网络错误，请重试';
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });

        // 设置默认用户名密码
        document.getElementById('username').value = '2314';
        document.getElementById('password').value = 'hzwy2314';
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染班级页面
async function renderClassPage(db) {
  const session = await validateSession(new Request('http://localhost'), db);
  if (!session || session.role !== 'class') {
    return Response.redirect(new URL('/login', 'http://localhost'));
  }

  const [studentsData, scoreCategories, tasks, settings] = await Promise.all([
    handleGetStudents(db).then(r => r.json()),
    db.prepare('SELECT * FROM score_categories ORDER BY type, id').all(),
    db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10').all(),
    db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').bind('site_title', 'class_name', 'current_month').all()
  ]);

  const settingMap = {};
  settings.results.forEach(row => {
    settingMap[row.key] = row.value;
  });

  const currentMonth = settingMap.current_month || new Date().toISOString().slice(0, 7);

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '2314班综合评分系统'}</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 1.5rem 2rem; 
            box-shadow: var(--shadow);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem; 
            font-size: 1.75rem;
        }
        
        .date { 
            font-size: 0.9rem; 
            opacity: 0.9; 
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .header-actions {
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            text-decoration: none;
        }
        
        .btn-primary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-primary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .btn-danger {
            background: var(--danger);
            color: white;
        }
        
        .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-2px);
        }
        
        .announcement {
            background: var(--surface); 
            margin: 1.5rem 2rem; 
            padding: 1.5rem; 
            border-radius: 16px;
            box-shadow: var(--shadow); 
            border-left: 6px solid var(--primary);
            animation: slideInUp 0.5s ease;
        }
        
        .main-content { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 2rem; 
            padding: 0 2rem 2rem; 
            max-width: 1400px; 
            margin: 0 auto;
        }
        
        .score-section { 
            background: var(--surface); 
            border-radius: 20px; 
            padding: 2rem;
            box-shadow: var(--shadow); 
            transition: all 0.3s ease;
            animation: fadeIn 0.6s ease;
            position: relative;
            overflow: hidden;
        }
        
        .score-section::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
        }
        
        .score-section:hover { 
            transform: translateY(-8px); 
            box-shadow: var(--shadow-lg);
        }
        
        .section-title { 
            font-size: 1.5rem; 
            margin-bottom: 1.5rem; 
            padding-bottom: 1rem;
            border-bottom: 2px solid var(--border); 
            color: var(--text); 
            display: flex; 
            justify-content: space-between;
            align-items: center;
            font-weight: 700;
        }
        
        .student-table { 
            width: 100%; 
            border-collapse: separate; 
            border-spacing: 0;
        }
        
        .student-table th, .student-table td { 
            padding: 1rem; 
            text-align: left; 
            border-bottom: 1px solid var(--border);
            transition: all 0.2s ease;
        }
        
        .student-table th { 
            background: var(--background); 
            font-weight: 600; 
            color: var(--text-light);
            position: sticky;
            top: 0;
            backdrop-filter: blur(10px);
        }
        
        .student-table tr:hover td { 
            background: var(--background); 
            transform: scale(1.02);
        }
        
        .student-table .score-cell { 
            cursor: pointer; 
            position: relative;
            font-weight: 600;
        }
        
        .student-table .score-cell:hover { 
            background: rgba(99, 102, 241, 0.1) !important; 
        }
        
        .add-score { color: var(--secondary); }
        .minus-score { color: var(--danger); }
        .total-score { 
            color: var(--primary); 
            font-weight: 700;
            font-size: 1.1em;
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 700;
            font-size: 0.875rem;
        }
        
        .rank-1 { background: linear-gradient(135deg, #f59e0b, #d97706); }
        .rank-2 { background: linear-gradient(135deg, #6b7280, #4b5563); }
        .rank-3 { background: linear-gradient(135deg, #92400e, #78350f); }
        
        .score-modal {
            display: none; 
            position: fixed; 
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 100%;
            background: rgba(0,0,0,0.5); 
            z-index: 1000; 
            align-items: center; 
            justify-content: center;
            animation: fadeIn 0.3s ease;
            backdrop-filter: blur(5px);
            padding: 1rem;
        }
        
        .modal-content {
            background: var(--surface); 
            padding: 2.5rem; 
            border-radius: 24px; 
            width: 100%; 
            max-width: 480px;
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border);
            position: relative;
        }
        
        .modal-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-light);
            transition: color 0.3s ease;
        }
        
        .modal-close:hover {
            color: var(--danger);
        }
        
        @keyframes fadeIn { 
            from { opacity: 0; } 
            to { opacity: 1; } 
        }
        
        @keyframes slideUp { 
            from { transform: translateY(30px); opacity: 0; } 
            to { transform: translateY(0); opacity: 1; } 
        }
        
        @keyframes slideInUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        .input-group { 
            margin-bottom: 1.5rem; 
        }
        
        .input-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: var(--text);
        }
        
        select, input[type="text"], input[type="number"] {
            width: 100%;
            padding: 1rem;
            border: 2px solid var(--border);
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: var(--surface);
            color: var(--text);
        }
        
        select:focus, input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .score-buttons { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 0.75rem; 
            margin: 1rem 0; 
        }
        
        .score-btn { 
            padding: 1rem; 
            border: 2px solid var(--border); 
            background: var(--surface); 
            border-radius: 12px;
            cursor: pointer; 
            transition: all 0.2s ease; 
            text-align: center;
            font-weight: 600;
            color: var(--text);
        }
        
        .score-btn:hover { 
            border-color: var(--primary); 
            background: rgba(99, 102, 241, 0.05);
            transform: translateY(-2px);
        }
        
        .score-btn.selected { 
            border-color: var(--primary); 
            background: var(--primary); 
            color: white;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        
        .action-buttons { 
            display: flex; 
            gap: 1rem; 
            margin-top: 2rem; 
        }
        
        .action-btn { 
            flex: 1; 
            padding: 1rem; 
            border: none; 
            border-radius: 12px; 
            cursor: pointer; 
            transition: all 0.3s ease; 
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        .submit-btn { 
            background: var(--secondary); 
            color: white; 
        }
        
        .submit-btn:hover { 
            background: #0da271;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
        }
        
        .revoke-btn { 
            background: var(--danger); 
            color: white; 
        }
        
        .revoke-btn:hover { 
            background: #dc2626;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(239, 68, 68, 0.3);
        }
        
        .cancel-btn { 
            background: var(--text-light); 
            color: white; 
        }
        
        .cancel-btn:hover { 
            background: #475569;
            transform: translateY(-2px);
        }
        
        .tasks-panel {
            position: fixed; 
            top: 0; 
            right: -480px; 
            width: 480px; 
            height: 100vh;
            background: var(--surface); 
            box-shadow: var(--shadow-lg); 
            transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            padding: 2rem; 
            overflow-y: auto; 
            z-index: 999;
            border-left: 1px solid var(--border);
        }
        
        .tasks-panel.active { right: 0; }
        
        .panel-overlay {
            display: none; 
            position: fixed; 
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 100%;
            background: rgba(0,0,0,0.5); 
            z-index: 998;
            backdrop-filter: blur(5px);
        }
        
        .panel-overlay.active { display: block; }
        
        .task-item {
            background: var(--background);
            padding: 1.5rem;
            border-radius: 16px;
            margin-bottom: 1rem;
            border-left: 4px solid var(--primary);
            transition: all 0.3s ease;
        }
        
        .task-item:hover {
            transform: translateX(8px);
            box-shadow: var(--shadow);
        }
        
        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 0.75rem;
        }
        
        .task-title {
            font-weight: 700;
            color: var(--text);
            font-size: 1.1rem;
        }
        
        .task-deadline {
            color: var(--danger);
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .task-content {
            color: var(--text-light);
            line-height: 1.6;
            margin-bottom: 1rem;
        }
        
        .task-meta {
            display: flex;
            justify-content: space-between;
            font-size: 0.875rem;
            color: var(--text-light);
        }
        
        .admin-panel {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            z-index: 100;
        }
        
        .admin-btn {
            background: var(--primary);
            color: white;
            border: none;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            font-size: 1.5rem;
            cursor: pointer;
            box-shadow: var(--shadow-lg);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .admin-btn:hover {
            transform: scale(1.1) rotate(90deg);
            box-shadow: 0 15px 30px rgba(99, 102, 241, 0.4);
        }
        
        .admin-menu {
            position: absolute;
            bottom: 70px;
            right: 0;
            background: var(--surface);
            border-radius: 16px;
            box-shadow: var(--shadow-lg);
            padding: 1rem;
            min-width: 200px;
            display: none;
            animation: slideInUp 0.3s ease;
        }
        
        .admin-menu.active {
            display: block;
        }
        
        .menu-item {
            padding: 0.75rem 1rem;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            cursor: pointer;
            border-radius: 8px;
            transition: background 0.2s ease;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .menu-item:hover {
            background: var(--background);
        }
        
        .menu-item.danger {
            color: var(--danger);
        }
        
        @media (max-width: 768px) {
            .main-content { 
                grid-template-columns: 1fr; 
                padding: 0 1rem 1rem; 
                gap: 1.5rem;
            }
            
            .header { 
                padding: 1rem; 
            }
            
            .header-content { 
                flex-direction: column; 
                gap: 1rem; 
                text-align: center; 
            }
            
            .header-actions {
                width: 100%;
                justify-content: center;
            }
            
            .tasks-panel { 
                width: 100%; 
                right: -100%; 
            }
            
            .score-section {
                padding: 1.5rem;
            }
            
            .announcement {
                margin: 1rem;
            }
            
            .admin-panel {
                bottom: 1rem;
                right: 1rem;
            }
        }
        
        @media (max-width: 480px) {
            .score-buttons {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .action-buttons {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
                <div class="date">
                    <span>📅</span>
                    <span id="currentDate"></span>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="openTasksPanel()">
                    <span>📋</span>
                    任务管理
                </button>
                <button class="btn btn-primary" onclick="openLogsPage()">
                    <span>📊</span>
                    操作日志
                </button>
                <button class="btn btn-danger" onclick="logout()">
                    <span>🚪</span>
                    退出登录
                </button>
            </div>
        </div>
    </div>

    <div class="announcement">
        <strong>📢 班级公告：</strong> 
        <span id="announcementText">欢迎使用班级综合评分系统！系统已更新，新增任务管理功能。</span>
        <button onclick="editAnnouncement()" style="margin-left: 1rem; background: none; border: none; color: var(--primary); cursor: pointer;">编辑</button>
    </div>

    <div class="main-content">
        <!-- 加分项排行榜 -->
        <div class="score-section">
            <div class="section-title">
                <span>🏆 加分排行榜</span>
                <span>总分</span>
            </div>
            <table class="student-table">
                <thead>
                    <tr>
                        <th width="80">排名</th>
                        <th>姓名</th>
                        <th width="120">加分</th>
                    </tr>
                </thead>
                <tbody id="addRankingsBody">
                    ${studentsData.addRankings.map((student, index) => `
                        <tr>
                            <td>
                                <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                    ${index + 1}
                                </div>
                            </td>
                            <td>${student.name}</td>
                            <td class="add-score">+${student.add_score}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <!-- 减分项排行榜 -->
        <div class="score-section">
            <div class="section-title">
                <span>⚠️ 扣分排行榜</span>
                <span>总分</span>
            </div>
            <table class="student-table">
                <thead>
                    <tr>
                        <th width="80">排名</th>
                        <th>姓名</th>
                        <th width="120">扣分</th>
                    </tr>
                </thead>
                <tbody id="minusRankingsBody">
                    ${studentsData.minusRankings.map((student, index) => `
                        <tr>
                            <td>
                                <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                    ${index + 1}
                                </div>
                            </td>
                            <td>${student.name}</td>
                            <td class="minus-score">-${student.minus_score}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <!-- 详细评分表格 -->
        <div class="score-section" style="grid-column: 1 / -1;">
            <div class="section-title">
                <span>📊 学生综合评分表</span>
                <span style="font-size: 0.9rem; color: var(--text-light);">点击分数单元格进行评分操作</span>
            </div>
            <div style="overflow-x: auto;">
                <table class="student-table">
                    <thead>
                        <tr>
                            <th width="120">姓名</th>
                            <th width="120" class="score-cell" onclick="showAllScores('add')">加分总分</th>
                            <th width="120" class="score-cell" onclick="showAllScores('minus')">扣分总分</th>
                            <th width="120">最终得分</th>
                            <th width="100">操作</th>
                        </tr>
                    </thead>
                    <tbody id="studentsBody">
                        ${studentsData.students.map((student, index) => `
                            <tr>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <span>${student.name}</span>
                                        ${index < 3 ? `<span class="rank-badge rank-${index + 1}" style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;">${index + 1}</span>` : ''}
                                    </div>
                                </td>
                                <td class="score-cell add-score" onclick="openScoreModal(${student.id}, 'add', '${student.name}')">
                                    +${student.add_score}
                                </td>
                                <td class="score-cell minus-score" onclick="openScoreModal(${student.id}, 'minus', '${student.name}')">
                                    -${student.minus_score}
                                </td>
                                <td class="total-score">
                                    ${student.total_score > 0 ? '+' : ''}${student.total_score}
                                </td>
                                <td>
                                    <button class="revoke-btn" style="padding: 0.5rem 1rem; font-size: 0.875rem; border-radius: 8px;" onclick="revokeLastAction(${student.id})">
                                        撤销
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- 评分弹窗 -->
    <div class="score-modal" id="scoreModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeScoreModal()">×</button>
            <h3 style="margin-bottom: 1.5rem; color: var(--text);" id="modalTitle">评分操作</h3>
            
            <div class="input-group">
                <label>评分项目：</label>
                <select id="categorySelect" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;">
                    ${scoreCategories.results.filter(cat => cat.type === 'add').map(cat => `
                        <option value="${cat.id}">${cat.name} (+${cat.weight}分)</option>
                    `).join('')}
                </select>
            </div>
            
            <div class="input-group">
                <label>操作教师：</label>
                <select id="operatorSelect" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;">
                    <option value="语文老师">语文老师</option>
                    <option value="数学老师">数学老师</option>
                    <option value="英语老师">英语老师</option>
                    <option value="政治老师">政治老师</option>
                    <option value="历史老师">历史老师</option>
                    <option value="物理老师">物理老师</option>
                    <option value="化学老师">化学老师</option>
                    <option value="班主任">班主任</option>
                </select>
            </div>
            
            <div class="input-group">
                <label>分值：</label>
                <div class="score-buttons" id="scoreButtons">
                    <div class="score-btn" data-score="1">+1</div>
                    <div class="score-btn" data-score="2">+2</div>
                    <div class="score-btn" data-score="3">+3</div>
                    <div class="score-btn" data-score="4">+4</div>
                    <div class="score-btn" data-score="5">+5</div>
                    <div class="score-btn" data-score="custom">自定义</div>
                </div>
                <input type="number" id="customScore" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px; margin-top: 0.5rem; display: none;" placeholder="输入自定义分值" min="1" max="100">
            </div>
            
            <div class="input-group">
                <label>备注说明：</label>
                <input type="text" id="scoreNote" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px;" placeholder="可选备注信息">
            </div>
            
            <div class="action-buttons">
                <button class="cancel-btn" onclick="closeScoreModal()">
                    <span>❌</span>
                    取消
                </button>
                <button class="submit-btn" onclick="submitScore()">
                    <span>✅</span>
                    提交评分
                </button>
            </div>
        </div>
    </div>

    <!-- 任务面板 -->
    <div class="panel-overlay" id="panelOverlay" onclick="closeTasksPanel()"></div>
    <div class="tasks-panel" id="tasksPanel">
        <h2 style="margin-bottom: 2rem; color: var(--text);">📋 任务管理系统</h2>
        
        <div style="margin-bottom: 2rem; background: var(--background); padding: 1.5rem; border-radius: 16px;">
            <h3 style="margin-bottom: 1rem; color: var(--text);">发布新任务</h3>
            <input type="text" id="taskTitle" placeholder="任务标题" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px; margin-bottom: 1rem;">
            <textarea id="taskContent" placeholder="任务内容描述" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px; margin-bottom: 1rem; height: 120px; resize: vertical;"></textarea>
            <input type="datetime-local" id="taskDeadline" style="width: 100%; padding: 1rem; border: 2px solid var(--border); border-radius: 12px; margin-bottom: 1.5rem;">
            <button class="submit-btn" style="width: 100%; padding: 1rem; font-size: 1.1rem;" onclick="addTask()">
                <span>🚀</span>
                发布任务
            </button>
        </div>
        
        <h3 style="margin-bottom: 1rem; color: var(--text);">近期任务</h3>
        <div id="tasksList">
            ${tasks.results.map(task => `
                <div class="task-item">
                    <div class="task-header">
                        <div class="task-title">${task.title}</div>
                        <div class="task-deadline">${new Date(task.deadline).toLocaleDateString('zh-CN')}</div>
                    </div>
                    <div class="task-content">${task.content}</div>
                    <div class="task-meta">
                        <span>发布者: ${task.created_by}</span>
                        <span>${new Date(task.created_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <!-- 管理员功能面板 -->
    <div class="admin-panel">
        <button class="admin-btn" onclick="toggleAdminMenu()">⚙️</button>
        <div class="admin-menu" id="adminMenu">
            <button class="menu-item" onclick="createSnapshot()">
                <span>💾</span>
                保存月度数据
            </button>
            <button class="menu-item" onclick="showMonthlyData()">
                <span>📈</span>
                查看历史数据
            </button>
            <button class="menu-item" onclick="resetScores()">
                <span>🔄</span>
                重置当前分数
            </button>
            <button class="menu-item danger" onclick="clearAllData()">
                <span>🗑️</span>
                清空所有数据
            </button>
        </div>
    </div>

    <script>
        let currentStudentId = null;
        let currentScoreType = 'add';
        let currentStudentName = '';
        let selectedScore = 1;
        let isAdminMenuOpen = false;

        // 设置当前日期
        document.getElementById('currentDate').textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });

        // 打开评分弹窗
        function openScoreModal(studentId, type, studentName) {
            currentStudentId = studentId;
            currentScoreType = type;
            currentStudentName = studentName;
            
            const modalTitle = document.getElementById('modalTitle');
            modalTitle.textContent = \`为 \${studentName} \${type === 'add' ? '加分' : '扣分'}\`;
            
            // 更新评分项目选项
            const categorySelect = document.getElementById('categorySelect');
            categorySelect.innerHTML = '';
            
            const categories = ${JSON.stringify(scoreCategories.results)};
            const filteredCategories = categories.filter(cat => cat.type === type);
            
            filteredCategories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = \`\${cat.name} (\${type === 'add' ? '+' : '-'}\${cat.weight}分)\`;
                categorySelect.appendChild(option);
            });
            
            // 如果是扣分，调整按钮显示
            const scoreButtons = document.querySelectorAll('.score-btn');
            if (type === 'minus') {
                scoreButtons.forEach(btn => {
                    if (btn.dataset.score !== 'custom') {
                        btn.textContent = btn.textContent.replace('+', '-');
                    }
                });
            } else {
                scoreButtons.forEach(btn => {
                    if (btn.dataset.score !== 'custom') {
                        btn.textContent = btn.textContent.replace('-', '+');
                    }
                });
            }
            
            // 重置选择
            selectedScore = filteredCategories[0]?.weight || 1;
            updateScoreButtons();
            document.getElementById('customScore').style.display = 'none';
            document.getElementById('customScore').value = '';
            document.getElementById('scoreNote').value = '';
            
            document.getElementById('scoreModal').style.display = 'flex';
        }

        // 关闭评分弹窗
        function closeScoreModal() {
            document.getElementById('scoreModal').style.display = 'none';
        }

        // 更新分数按钮状态
        function updateScoreButtons() {
            document.querySelectorAll('.score-btn').forEach(btn => {
                btn.classList.remove('selected');
                if (btn.dataset.score === 'custom' && document.getElementById('customScore').style.display === 'block') {
                    btn.classList.add('selected');
                } else if (parseInt(btn.dataset.score) === selectedScore) {
                    btn.classList.add('selected');
                }
            });
        }

        // 分数按钮事件处理
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.score-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    if (this.dataset.score === 'custom') {
                        document.getElementById('customScore').style.display = 'block';
                        document.getElementById('customScore').focus();
                    } else {
                        document.getElementById('customScore').style.display = 'none';
                        selectedScore = parseInt(this.dataset.score);
                        updateScoreButtons();
                    }
                });
            });

            document.getElementById('customScore').addEventListener('input', function() {
                selectedScore = parseInt(this.value) || 0;
                updateScoreButtons();
            });

            // 点击弹窗外部关闭
            document.getElementById('scoreModal').addEventListener('click', function(e) {
                if (e.target === this) closeScoreModal();
            });
        });

        // 提交分数
        async function submitScore() {
            const categoryId = document.getElementById('categorySelect').value;
            const operator = document.getElementById('operatorSelect').value;
            const note = document.getElementById('scoreNote').value;
            
            let score = selectedScore;
            if (document.getElementById('customScore').style.display === 'block') {
                score = parseInt(document.getElementById('customScore').value) || 1;
            }

            if (score <= 0) {
                alert('分值必须大于0');
                return;
            }

            try {
                const response = await fetch('/api/score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: currentStudentId,
                        categoryId: categoryId,
                        score: score,
                        operator: operator,
                        note: note
                    })
                });

                const result = await response.json();

                if (result.success) {
                    closeScoreModal();
                    showNotification('评分提交成功！', 'success');
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '提交失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 撤销操作
        async function revokeLastAction(studentId) {
            if (!confirm('确定要撤销该学生的最后一次操作吗？')) return;
            
            try {
                const response = await fetch('/api/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('撤销操作成功！', 'success');
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification(result.error || '撤销失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 显示通知
        function showNotification(message, type = 'info') {
            // 创建通知元素
            const notification = document.createElement('div');
            notification.style.cssText = \`
                position: fixed;
                top: 2rem;
                right: 2rem;
                padding: 1rem 1.5rem;
                border-radius: 12px;
                color: white;
                font-weight: 600;
                z-index: 10000;
                animation: slideInRight 0.3s ease;
                box-shadow: var(--shadow);
            \`;
            
            if (type === 'success') {
                notification.style.background = 'var(--secondary)';
            } else if (type === 'error') {
                notification.style.background = 'var(--danger)';
            } else {
                notification.style.background = 'var(--primary)';
            }
            
            notification.textContent = message;
            document.body.appendChild(notification);
            
            // 3秒后自动移除
            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, 3000);
        }

        // 任务面板功能
        function openTasksPanel() {
            document.getElementById('tasksPanel').classList.add('active');
            document.getElementById('panelOverlay').classList.add('active');
        }

        function closeTasksPanel() {
            document.getElementById('tasksPanel').classList.remove('active');
            document.getElementById('panelOverlay').classList.remove('active');
        }

        // 添加任务
        async function addTask() {
            const title = document.getElementById('taskTitle').value.trim();
            const content = document.getElementById('taskContent').value.trim();
            const deadline = document.getElementById('taskDeadline').value;

            if (!title || !content) {
                showNotification('请填写任务标题和内容', 'error');
                return;
            }

            if (!deadline) {
                showNotification('请设置任务截止时间', 'error');
                return;
            }

            try {
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title,
                        content,
                        deadline,
                        created_by: '班级账号'
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('任务发布成功！', 'success');
                    document.getElementById('taskTitle').value = '';
                    document.getElementById('taskContent').value = '';
                    document.getElementById('taskDeadline').value = '';
                    closeTasksPanel();
                    setTimeout(() => location.reload(), 1500);
                } else {
                    showNotification('发布任务失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 管理员菜单
        function toggleAdminMenu() {
            const menu = document.getElementById('adminMenu');
            isAdminMenuOpen = !isAdminMenuOpen;
            menu.classList.toggle('active', isAdminMenuOpen);
        }

        // 点击外部关闭管理员菜单
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.admin-panel') && isAdminMenuOpen) {
                toggleAdminMenu();
            }
        });

        // 创建月度快照
        async function createSnapshot() {
            const month = '${currentMonth}';
            const title = prompt('请输入本次快照的标题（如：期中考核）:');
            if (!title) return;

            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month, title })
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('月度数据保存成功！', 'success');
                    toggleAdminMenu();
                } else {
                    showNotification('保存失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 重置分数
        async function resetScores() {
            if (!confirm('确定要重置所有学生的分数吗？此操作不可撤销！')) return;
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const result = await response.json();

                if (result.success) {
                    showNotification('分数重置成功！', 'success');
                    toggleAdminMenu();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showNotification('重置失败', 'error');
                }
            } catch (error) {
                showNotification('网络错误，请重试', 'error');
            }
        }

        // 清空所有数据
        async function clearAllData() {
            if (!confirm('⚠️ 警告：这将清空所有数据（包括历史记录）！确定要继续吗？')) return;
            if (!confirm('🚨 最后一次确认：此操作将永久删除所有数据！')) return;
            
            try {
                // 这里需要实现清空所有数据的API
                showNotification('数据清空功能开发中...', 'info');
                toggleAdminMenu();
            } catch (error) {
                showNotification('操作失败', 'error');
            }
        }

        // 显示月度数据
        async function showMonthlyData() {
            try {
                const response = await fetch('/api/monthly');
                const months = await response.json();
                
                if (months.length === 0) {
                    showNotification('暂无历史数据', 'info');
                    return;
                }
                
                let message = '历史月度数据:\\n';
                months.forEach(month => {
                    message += \`• \${month}\\n\`;
                });
                
                alert(message);
                toggleAdminMenu();
            } catch (error) {
                showNotification('获取数据失败', 'error');
            }
        }

        // 编辑公告
        function editAnnouncement() {
            const currentText = document.getElementById('announcementText').textContent;
            const newText = prompt('编辑班级公告:', currentText);
            if (newText !== null) {
                document.getElementById('announcementText').textContent = newText;
                showNotification('公告更新成功！', 'success');
            }
        }

        // 打开日志页面
        function openLogsPage() {
            window.open('/logs', '_blank');
        }

        // 退出登录
        async function logout() {
            try {
                await fetch('/api/logout');
                window.location.href = '/login';
            } catch (error) {
                window.location.href = '/login';
            }
        }

        // 显示所有学生分数详情
        function showAllScores(type) {
            const students = ${JSON.stringify(studentsData.students)};
            let message = \`\${type === 'add' ? '加分' : '扣分'}详情:\\n\\n\`;
            
            const sortedStudents = [...students].sort((a, b) => {
                return type === 'add' ? b.add_score - a.add_score : b.minus_score - a.minus_score;
            });
            
            sortedStudents.forEach((student, index) => {
                const score = type === 'add' ? student.add_score : student.minus_score;
                message += \`\${index + 1}. \${student.name}: \${type === 'add' ? '+' : '-'}\${score}\\n\`;
            });
            
            alert(message);
        }

        // 添加CSS动画
        const style = document.createElement('style');
        style.textContent = \`
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            
            @keyframes slideOutRight {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        \`;
        document.head.appendChild(style);
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染访客页面
async function renderVisitorPage(db) {
  const studentsData = await handleGetStudents(db).then(r => r.json());
  const settings = await db.prepare(
    'SELECT key, value FROM settings WHERE key IN (?, ?)'
  ).bind('site_title', 'class_name').all();

  const settingMap = {};
  settings.results.forEach(row => {
    settingMap[row.key] = row.value;
  });

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 访客视图</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 2rem 1rem; 
            text-align: center;
            box-shadow: var(--shadow);
        }
        
        .header h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem;
            font-size: 2rem;
        }
        
        .header .subtitle {
            opacity: 0.9;
            margin-bottom: 1rem;
        }
        
        .login-prompt { 
            text-align: center; 
            padding: 2rem 1rem; 
            background: var(--surface);
            margin: 1rem;
            border-radius: 16px;
            box-shadow: var(--shadow);
        }
        
        .login-btn { 
            background: linear-gradient(135deg, var(--primary), var(--primary-dark)); 
            color: white; 
            padding: 1rem 2rem; 
            border: none; 
            border-radius: 12px; 
            text-decoration: none; 
            display: inline-block; 
            margin-top: 1rem;
            font-weight: 600;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }
        
        .login-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
        }
        
        .ranking-table { 
            width: 100%; 
            border-collapse: separate; 
            border-spacing: 0;
            background: var(--surface);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: var(--shadow);
            margin: 1rem 0;
        }
        
        .ranking-table th, .ranking-table td { 
            padding: 1.25rem 1rem; 
            text-align: center; 
            border-bottom: 1px solid var(--border);
        }
        
        .ranking-table th { 
            background: var(--background); 
            font-weight: 600; 
            color: var(--text-light);
        }
        
        .ranking-table tr:last-child td { 
            border-bottom: none; 
        }
        
        .ranking-table tr:hover td {
            background: var(--background);
        }
        
        .container { 
            padding: 1rem; 
            max-width: 600px; 
            margin: 0 auto; 
        }
        
        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 2rem 0 1rem;
            text-align: center;
            color: var(--text);
        }
        
        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            font-weight: 700;
            font-size: 0.875rem;
        }
        
        .rank-1 { background: linear-gradient(135deg, #f59e0b, #d97706); }
        .rank-2 { background: linear-gradient(135deg, #6b7280, #4b5563); }
        .rank-3 { background: linear-gradient(135deg, #92400e, #78350f); }
        
        .positive { color: var(--secondary); font-weight: 600; }
        .negative { color: var(--danger); font-weight: 600; }
        .total { color: var(--primary); font-weight: 700; }
        
        @media (max-width: 480px) {
            .header h1 {
                font-size: 1.5rem;
            }
            
            .ranking-table {
                font-size: 0.9rem;
            }
            
            .ranking-table th, .ranking-table td {
                padding: 1rem 0.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${settingMap.site_title || '2314班综合评分系统'}</h1>
        <div class="subtitle">${settingMap.class_name || '2314班'} - 访客视图</div>
    </div>
    
    <div class="container">
        <div class="login-prompt">
            <p style="font-size: 1.1rem; margin-bottom: 1rem; color: var(--text);">查看完整功能请登录系统</p>
            <a href="/login" class="login-btn">🔐 立即登录</a>
        </div>
        
        <div class="section-title">🏆 学生评分总榜</div>
        
        <table class="ranking-table">
            <thead>
                <tr>
                    <th width="80">排名</th>
                    <th>姓名</th>
                    <th width="120">总分</th>
                </tr>
            </thead>
            <tbody>
                ${studentsData.students.map((student, index) => `
                    <tr>
                        <td>
                            <div class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">
                                ${index + 1}
                            </div>
                        </td>
                        <td>${student.name}</td>
                        <td class="total">
                            ${student.total_score > 0 ? '+' : ''}${student.total_score}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        
        <div class="section-title">📈 排行榜</div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem;">
            <div style="background: var(--surface); padding: 1.5rem; border-radius: 16px; box-shadow: var(--shadow);">
                <h3 style="margin-bottom: 1rem; color: var(--secondary); text-align: center;">👍 加分榜</h3>
                ${studentsData.addRankings.slice(0, 5).map((student, index) => `
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: ${index < 4 ? '1px solid var(--border)' : 'none'};">
                        <span>${index + 1}. ${student.name}</span>
                        <span class="positive">+${student.add_score}</span>
                    </div>
                `).join('')}
            </div>
            
            <div style="background: var(--surface); padding: 1.5rem; border-radius: 16px; box-shadow: var(--shadow);">
                <h3 style="margin-bottom: 1rem; color: var(--danger); text-align: center;">👎 扣分榜</h3>
                ${studentsData.minusRankings.slice(0, 5).map((student, index) => `
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: ${index < 4 ? '1px solid var(--border)' : 'none'};">
                        <span>${index + 1}. ${student.name}</span>
                        <span class="negative">-${student.minus_score}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染管理员页面
async function renderAdminPage(db) {
  const session = await validateSession(new Request('http://localhost'), db);
  if (!session || session.role !== 'admin') {
    return Response.redirect(new URL('/login', 'http://localhost'));
  }

  const [studentsData, logs, settings] = await Promise.all([
    handleGetStudents(db).then(r => r.json()),
    db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT 50').all(),
    db.prepare('SELECT key, value FROM settings').all()
  ]);

  const settingMap = {};
  settings.results.forEach(row => {
    settingMap[row.key] = row.value;
  });

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settingMap.site_title || '班级评分系统'} - 管理员</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            min-height: 100vh;
        }
        
        .header { 
            background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); 
            color: white; 
            padding: 1.5rem 2rem; 
            box-shadow: var(--shadow);
        }
        
        .header-content { 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .class-info h1 { 
            font-weight: 700; 
            margin-bottom: 0.5rem; 
        }
        
        .admin-badge {
            background: rgba(255,255,255,0.2);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            margin-left: 1rem;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-primary:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
        }
        
        .card {
            background: var(--surface);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
        }
        
        .card:hover {
            transform: translateY(-8px);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }
        
        .card-full {
            grid-column: 1 / -1;
        }
        
        .card-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: var(--background);
            padding: 1.5rem;
            border-radius: 16px;
            text-align: center;
            border-left: 4px solid var(--primary);
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            color: var(--text-light);
            font-size: 0.875rem;
        }
        
        .table-container {
            overflow-x: auto;
        }
        
        .data-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
        }
        
        .data-table th, .data-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        
        .data-table th {
            background: var(--background);
            font-weight: 600;
            color: var(--text-light);
            position: sticky;
            top: 0;
        }
        
        .data-table tr:hover td {
            background: var(--background);
        }
        
        .positive { color: var(--secondary); font-weight: 600; }
        .negative { color: var(--danger); font-weight: 600; }
        
        .log-item {
            padding: 1rem;
            border-left: 4px solid var(--primary);
            background: var(--background);
            border-radius: 8px;
            margin-bottom: 1rem;
            transition: all 0.2s ease;
        }
        
        .log-item:hover {
            transform: translateX(8px);
        }
        
        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }
        
        .log-student {
            font-weight: 600;
            color: var(--text);
        }
        
        .log-score {
            font-weight: 700;
        }
        
        .log-details {
            color: var(--text-light);
            font-size: 0.875rem;
        }
        
        .settings-form {
            display: grid;
            gap: 1.5rem;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .form-group label {
            font-weight: 600;
            color: var(--text);
        }
        
        .form-group input {
            padding: 1rem;
            border: 2px solid var(--border);
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .btn-success {
            background: var(--secondary);
            color: white;
        }
        
        .btn-success:hover {
            background: #0da271;
            transform: translateY(-2px);
        }
        
        .btn-danger {
            background: var(--danger);
            color: white;
        }
        
        .btn-danger:hover {
            background: #dc2626;
            transform: translateY(-2px);
        }
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
                padding: 1rem;
                gap: 1.5rem;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 1rem;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
                text-align: center;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="class-info">
                <h1>${settingMap.site_title || '2314班综合评分系统'}
                    <span class="admin-badge">管理员模式</span>
                </h1>
                <div>系统管理面板</div>
            </div>
            <div>
                <a href="/class" class="btn btn-primary">📊 班级视图</a>
                <button class="btn btn-primary" onclick="logout()">🚪 退出登录</button>
            </div>
        </div>
    </div>

    <div class="main-content">
        <!-- 统计信息 -->
        <div class="card card-full">
            <div class="card-title">📈 系统概览</div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.length}</div>
                    <div class="stat-label">学生总数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.reduce((acc, s) => acc + s.add_score, 0)}</div>
                    <div class="stat-label">总加分</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${studentsData.students.reduce((acc, s) => acc + s.minus_score, 0)}</div>
                    <div class="stat-label">总扣分</div>
                </div>
            </div>
        </div>

        <!-- 系统设置 -->
        <div class="card">
            <div class="card-title">⚙️ 系统设置</div>
            <form class="settings-form" id="settingsForm">
                <div class="form-group">
                    <label>网站标题</label>
                    <input type="text" name="site_title" value="${settingMap.site_title || ''}" required>
                </div>
                <div class="form-group">
                    <label>班级名称</label>
                    <input type="text" name="class_name" value="${settingMap.class_name || ''}" required>
                </div>
                <div class="form-group">
                    <label>班级账号</label>
                    <input type="text" name="class_username" value="${settingMap.class_username || ''}" required>
                </div>
                <div class="form-group">
                    <label>班级密码</label>
                    <input type="password" name="class_password" value="${settingMap.class_password || ''}" required>
                </div>
                <div class="form-group">
                    <label>管理员账号</label>
                    <input type="text" name="admin_username" value="${settingMap.admin_username || ''}" required>
                </div>
                <div class="form-group">
                    <label>管理员密码</label>
                    <input type="password" name="admin_password" value="${settingMap.admin_password || ''}" required>
                </div>
                <button type="submit" class="btn btn-success">💾 保存设置</button>
            </form>
        </div>

        <!-- 系统管理 -->
        <div class="card">
            <div class="card-title">🔧 系统管理</div>
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <button class="btn btn-primary" onclick="createSnapshot()">
                    💾 保存月度数据
                </button>
                <button class="btn btn-primary" onclick="showMonthlyData()">
                    📈 查看历史数据
                </button>
                <button class="btn btn-danger" onclick="resetScores()">
                    🔄 重置当前分数
                </button>
                <button class="btn btn-danger" onclick="clearAllData()">
                    🗑️ 清空所有数据
                </button>
            </div>
        </div>

        <!-- 操作日志 -->
        <div class="card card-full">
            <div class="card-title">📋 最近操作日志</div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>学生</th>
                            <th>操作类型</th>
                            <th>分数变化</th>
                            <th>操作教师</th>
                            <th>备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.results.map(log => `
                            <tr>
                                <td>${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                                <td>${log.student_name}</td>
                                <td>
                                    <span style="padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.875rem; background: ${log.action_type === 'add' ? 'var(--secondary)' : log.action_type === 'minus' ? 'var(--danger)' : 'var(--warning)'}; color: white;">
                                        ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销'}
                                    </span>
                                </td>
                                <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                                    ${log.score_change > 0 ? '+' : ''}${log.score_change}
                                </td>
                                <td>${log.operator}</td>
                                <td>${log.note || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        // 保存设置
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const settings = Object.fromEntries(formData);
            
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('设置保存成功！');
                    location.reload();
                } else {
                    alert('保存失败，请重试');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        });

        // 创建快照
        async function createSnapshot() {
            const month = '${new Date().toISOString().slice(0, 7)}';
            const title = prompt('请输入本次快照的标题:');
            if (!title) return;
            
            try {
                const response = await fetch('/api/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month, title })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('月度数据保存成功！');
                } else {
                    alert('保存失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }

        // 显示月度数据
        async function showMonthlyData() {
            try {
                const response = await fetch('/api/monthly');
                const months = await response.json();
                
                if (months.length === 0) {
                    alert('暂无历史数据');
                    return;
                }
                
                let message = '历史月度数据:\\n\\n';
                months.forEach(month => {
                    message += \`• \${month}\\n\`;
                });
                
                alert(message);
            } catch (error) {
                alert('获取数据失败');
            }
        }

        // 重置分数
        async function resetScores() {
            if (!confirm('确定要重置所有学生的分数吗？此操作不可撤销！')) return;
            
            try {
                const response = await fetch('/api/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('分数重置成功！');
                    location.reload();
                } else {
                    alert('重置失败');
                }
            } catch (error) {
                alert('网络错误，请重试');
            }
        }

        // 清空所有数据
        async function clearAllData() {
            if (!confirm('⚠️ 警告：这将清空所有数据（包括历史记录）！确定要继续吗？')) return;
            if (!confirm('🚨 最后一次确认：此操作将永久删除所有数据！')) return;
            
            alert('数据清空功能开发中...');
        }

        // 退出登录
        async function logout() {
            try {
                await fetch('/api/logout');
                window.location.href = '/login';
            } catch (error) {
                window.location.href = '/login';
            }
        }
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 渲染日志页面
async function renderLogsPage(db, url) {
  const studentId = url.searchParams.get('studentId');
  
  let logs;
  if (studentId) {
    logs = await db.prepare(`
      SELECT ol.*, s.name as student_name 
      FROM operation_logs ol
      JOIN students s ON ol.student_id = s.id
      WHERE ol.student_id = ?
      ORDER BY ol.created_at DESC
      LIMIT 100
    `).bind(studentId).all();
  } else {
    logs = await db.prepare(`
      SELECT ol.*, s.name as student_name 
      FROM operation_logs ol
      JOIN students s ON ol.student_id = s.id
      ORDER BY ol.created_at DESC
      LIMIT 100
    `).all();
  }

  const students = await db.prepare('SELECT id, name FROM students ORDER BY name').all();

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>操作日志 - 班级评分系统</title>
    <style>
        * { 
            margin: 0; padding: 0; box-sizing: border-box; 
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; 
        }
        
        :root {
            --primary: #6366f1;
            --background: #f8fafc;
            --surface: #ffffff;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        body { 
            background: var(--background); 
            color: var(--text);
            padding: 2rem;
        }
        
        .header {
            text-align: center;
            margin-bottom: 2rem;
        }
        
        .filters {
            background: var(--surface);
            padding: 1.5rem;
            border-radius: 16px;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        
        select, button {
            padding: 0.75rem 1rem;
            border: 2px solid var(--border);
            border-radius: 8px;
            background: var(--surface);
            color: var(--text);
        }
        
        button {
            background: var(--primary);
            color: white;
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        button:hover {
            transform: translateY(-2px);
        }
        
        .log-table {
            width: 100%;
            background: var(--surface);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: var(--shadow);
        }
        
        .log-table th, .log-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        
        .log-table th {
            background: var(--background);
            font-weight: 600;
            color: var(--text-light);
        }
        
        .positive { color: #10b981; font-weight: 600; }
        .negative { color: #ef4444; font-weight: 600; }
        
        .back-btn {
            display: inline-block;
            margin-bottom: 1rem;
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <a href="/class" class="back-btn">← 返回班级视图</a>
    
    <div class="header">
        <h1>操作日志</h1>
    </div>
    
    <div class="filters">
        <select id="studentFilter">
            <option value="">所有学生</option>
            ${students.results.map(s => `
                <option value="${s.id}" ${studentId == s.id ? 'selected' : ''}>${s.name}</option>
            `).join('')}
        </select>
        <button onclick="filterLogs()">筛选</button>
        <button onclick="clearFilter()">清除筛选</button>
    </div>
    
    <table class="log-table">
        <thead>
            <tr>
                <th>时间</th>
                <th>学生</th>
                <th>操作类型</th>
                <th>分数变化</th>
                <th>操作教师</th>
                <th>项目</th>
                <th>备注</th>
            </tr>
        </thead>
        <tbody>
            ${logs.results.map(log => `
                <tr>
                    <td>${new Date(log.created_at).toLocaleString('zh-CN')}</td>
                    <td>${log.student_name}</td>
                    <td>
                        <span style="padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; background: ${log.action_type === 'add' ? '#10b981' : log.action_type === 'minus' ? '#ef4444' : '#f59e0b'}; color: white;">
                            ${log.action_type === 'add' ? '加分' : log.action_type === 'minus' ? '扣分' : '撤销'}
                        </span>
                    </td>
                    <td class="${log.score_change > 0 ? 'positive' : 'negative'}">
                        ${log.score_change > 0 ? '+' : ''}${log.score_change}
                    </td>
                    <td>${log.operator}</td>
                    <td>${log.category_name}</td>
                    <td>${log.note || '-'}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <script>
        function filterLogs() {
            const studentId = document.getElementById('studentFilter').value;
            let url = '/logs';
            if (studentId) {
                url += \`?studentId=\${studentId}\`;
            }
            window.location.href = url;
        }
        
        function clearFilter() {
            window.location.href = '/logs';
        }
    </script>
</body>
</html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}