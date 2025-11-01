// 完全修复版邮件管理系统
export default {
  async email(message, env, ctx) {
    try {
      console.log('📧 开始处理邮件...');
      
      // 初始化数据库
      await initializeDatabase(env);
      
      const from = message.from;
      const to = message.to;
      const subject = message.headers.get("subject") || "无主题";
      
      console.log('邮件信息:', { from, to, subject });
      
      // 尝试获取邮件内容
      let text = '';
      let html = '';
      
      try {
        text = await message.text();
        console.log('文本内容长度:', text.length);
      } catch (e) {
        console.log('获取文本内容失败:', e.message);
        text = '无法读取邮件内容';
      }
      
      try {
        html = await message.html();
        console.log('HTML内容长度:', html?.length || 0);
      } catch (e) {
        console.log('获取HTML内容失败:', e.message);
        html = '';
      }
      
      // 记录原始邮件信息用于调试
      console.log('邮件头信息:', {
        from: from,
        to: to,
        subject: subject,
        messageId: message.headers.get('message-id'),
        date: message.headers.get('date')
      });
      
      // 检查拦截规则
      const shouldBlock = await checkBlockRules(from, subject, text, env);
      if (shouldBlock) {
        console.log(`🚫 邮件被拦截: ${from} -> ${to}`);
        // 即使被拦截也存储到垃圾邮件文件夹
        await saveEmailToDatabase(env, from, to, subject, text, html, 3, 1);
        return;
      }
      
      // 存储邮件到数据库 - 收件箱
      await saveEmailToDatabase(env, from, to, subject, text, html, 1, 0);
      
      console.log('✅ 邮件处理完成');
      
    } catch (error) {
      console.error('❌ 处理邮件时出错:', error);
      // 即使出错也尝试存储邮件基本信息
      try {
        await saveEmailToDatabase(env, message.from, message.to, "处理错误的邮件", "邮件处理过程中发生错误: " + error.message, "", 3, 1);
      } catch (e) {
        console.error('连错误邮件都无法存储:', e);
      }
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log('收到请求:', request.method, path);
    
    // 初始化数据库
    try {
      await initializeDatabase(env);
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
    
    // API 路由
    const routes = {
      'POST:/login': () => this.handleLogin(request, env),
      'POST:/logout': () => this.handleLogout(),
      'GET:/api/emails': () => this.getEmails(request, env),
      'POST:/api/emails/delete': () => this.deleteEmail(request, env),
      'POST:/api/emails/move': () => this.moveEmail(request, env),
      'POST:/api/emails/mark-read': () => this.markEmailRead(request, env),
      'POST:/api/emails/mark-spam': () => this.markEmailSpam(request, env),
      'POST:/api/send': () => this.sendEmail(request, env),
      'GET:/api/folders': () => this.getFolders(request, env),
      'POST:/api/folders': () => this.createFolder(request, env),
      'POST:/api/folders/delete': () => this.deleteFolder(request, env),
      'GET:/api/rules': () => this.getRules(request, env),
      'POST:/api/rules': () => this.createRule(request, env),
      'POST:/api/rules/delete': () => this.deleteRule(request, env),
      'POST:/api/db/reset': () => this.resetDatabase(request, env),
      'GET:/api/stats': () => this.getStats(request, env),
      'GET:/api/debug': () => this.getDebugInfo(request, env),
    };
    
    const routeKey = `${request.method}:${path}`;
    if (routes[routeKey]) {
      if (!['POST:/login', 'POST:/api/db/reset', 'GET:/api/debug'].includes(routeKey)) {
        const authResult = await this.checkAuth(request, env);
        if (!authResult.authenticated) {
          return new Response(JSON.stringify({ success: false, message: "未登录" }), { status: 401 });
        }
      }
      return await routes[routeKey]();
    }
    
    return this.getAdminInterface(request, env);
  },

  // 调试信息
  async getDebugInfo(request, env) {
    try {
      // 检查数据库表
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all();
      
      // 检查邮件数量
      const emailCount = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM emails"
      ).first();
      
      // 检查文件夹
      const folders = await env.DB.prepare(
        "SELECT id, name FROM folders"
      ).all();
      
      return new Response(JSON.stringify({
        success: true,
        debug: {
          tables: tables.results,
          emailCount: emailCount?.count || 0,
          folders: folders.results,
          timestamp: new Date().toISOString()
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取调试信息失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 检查认证状态
  async checkAuth(request, env) {
    try {
      const cookieHeader = request.headers.get('Cookie');
      if (!cookieHeader) return { authenticated: false };
      
      const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
      const sessionToken = cookies['mail_session'];
      
      if (!sessionToken) return { authenticated: false };
      
      if (sessionToken === 'authenticated') {
        return { authenticated: true };
      }
      
      return { authenticated: false };
    } catch (error) {
      return { authenticated: false };
    }
  },

  // 处理登录
  async handleLogin(request, env) {
    try {
      const { username, password } = await request.json();
      
      const ADMIN_USERNAME = "admin";
      const ADMIN_PASSWORD = "1591156135qwzxcv";
      
      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const response = new Response(JSON.stringify({ 
          success: true, 
          message: "登录成功" 
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Set-Cookie': `mail_session=authenticated; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
          }
        });
        return response;
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "用户名或密码错误" 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "请求解析错误" 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 处理退出登录
  handleLogout() {
    const response = new Response(JSON.stringify({ 
      success: true, 
      message: "已退出登录" 
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Set-Cookie': `mail_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      }
    });
    return response;
  },

  // 获取邮件列表
  async getEmails(request, env) {
    try {
      const url = new URL(request.url);
      const folderId = url.searchParams.get('folder') || '1';
      const page = parseInt(url.searchParams.get('page')) || 1;
      const limit = 20;
      const offset = (page - 1) * limit;
      
      console.log('获取邮件列表:', { folderId, page, limit, offset });
      
      // 获取邮件总数
      const countResult = await env.DB.prepare(
        "SELECT COUNT(*) as total FROM emails WHERE folder_id = ? AND is_deleted = 0"
      ).bind(folderId).first();
      
      // 获取邮件列表
      const result = await env.DB.prepare(
        `SELECT e.id, e.sender, e.recipient, e.subject, e.body, e.html_body, 
                e.is_read, e.has_attachments, e.received_at, f.name as folder_name
         FROM emails e 
         LEFT JOIN folders f ON e.folder_id = f.id 
         WHERE e.folder_id = ? AND e.is_deleted = 0 
         ORDER BY e.received_at DESC 
         LIMIT ? OFFSET ?`
      ).bind(folderId, limit, offset).all();
      
      console.log('查询结果数量:', (result.results || []).length);
      
      return new Response(JSON.stringify({
        success: true,
        emails: result.results || [],
        pagination: {
          page,
          limit,
          total: countResult?.total || 0,
          totalPages: Math.ceil((countResult?.total || 0) / limit)
        }
      }), {
        headers: { 
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error("获取邮件列表错误:", error);
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取邮件列表失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 删除邮件
  async deleteEmail(request, env) {
    try {
      const { id, permanent = false } = await request.json();
      
      if (permanent) {
        await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
      } else {
        await env.DB.prepare("UPDATE emails SET folder_id = 4 WHERE id = ?").bind(id).run();
      }
      
      return new Response(JSON.stringify({
        success: true,
        message: permanent ? "邮件已永久删除" : "邮件已移动到已删除文件夹"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "删除邮件失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 移动邮件
  async moveEmail(request, env) {
    try {
      const { id, folderId } = await request.json();
      
      await env.DB.prepare("UPDATE emails SET folder_id = ? WHERE id = ?").bind(folderId, id).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: "邮件已移动"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "移动邮件失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 标记已读/未读
  async markEmailRead(request, env) {
    try {
      const { id, read } = await request.json();
      
      await env.DB.prepare("UPDATE emails SET is_read = ? WHERE id = ?").bind(read ? 1 : 0, id).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: read ? "邮件已标记为已读" : "邮件已标记为未读"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "标记邮件失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 标记垃圾邮件
  async markEmailSpam(request, env) {
    try {
      const { id, isSpam } = await request.json();
      
      await env.DB.prepare("UPDATE emails SET folder_id = ?, is_spam = ? WHERE id = ?")
        .bind(isSpam ? 3 : 1, isSpam ? 1 : 0, id).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: isSpam ? "邮件已标记为垃圾邮件" : "邮件已移回收件箱"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "操作失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 发送邮件
  async sendEmail(request, env) {
    try {
      const { to, subject, text, fromUser = 'sak' } = await request.json();
      const from = `${fromUser}@ilqx.dpdns.org`;
      
      // 使用Resend发送邮件
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: from,
          to: to,
          subject: subject,
          text: text,
        }),
      });

      const result = await resendResponse.json();
      
      if (resendResponse.ok) {
        // 将发送的邮件保存到已发送文件夹
        await saveEmailToDatabase(env, from, to, subject, text, "", 2, 0);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: "邮件发送成功",
          id: result.id 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "发送失败: " + (result.message || "未知错误") 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "发送请求失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 获取文件夹
  async getFolders(request, env) {
    try {
      const result = await env.DB.prepare(
        "SELECT id, name, created_at FROM folders ORDER BY id"
      ).all();
      
      return new Response(JSON.stringify({
        success: true,
        folders: result.results || []
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取文件夹失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 创建文件夹
  async createFolder(request, env) {
    try {
      const { name } = await request.json();
      
      const result = await env.DB.prepare(
        "INSERT INTO folders (name) VALUES (?)"
      ).bind(name).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: "文件夹创建成功",
        folder: { id: result.meta.last_row_id, name }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "创建文件夹失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 删除文件夹
  async deleteFolder(request, env) {
    try {
      const { id } = await request.json();
      
      if (id <= 4) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "系统默认文件夹不能删除" 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      await env.DB.prepare("UPDATE emails SET folder_id = 1 WHERE folder_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(id).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: "文件夹已删除"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "删除文件夹失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 获取拦截规则
  async getRules(request, env) {
    try {
      const result = await env.DB.prepare(
        "SELECT id, name, type, value, action, target_folder_id, is_active, created_at FROM rules ORDER BY created_at DESC"
      ).all();
      
      return new Response(JSON.stringify({
        success: true,
        rules: result.results || []
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取拦截规则失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 创建拦截规则
  async createRule(request, env) {
    try {
      const { name, type, value, action, target_folder_id } = await request.json();
      
      const result = await env.DB.prepare(
        "INSERT INTO rules (name, type, value, action, target_folder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)"
      ).bind(name, type, value, action, target_folder_id).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: "拦截规则创建成功",
        rule: { id: result.meta.last_row_id, name, type, value, action, target_folder_id, is_active: 1 }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "创建拦截规则失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 删除拦截规则
  async deleteRule(request, env) {
    try {
      const { id } = await request.json();
      
      await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(id).run();
      
      return new Response(JSON.stringify({
        success: true,
        message: "拦截规则已删除"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "删除拦截规则失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 重置数据库
  async resetDatabase(request, env) {
    try {
      const tables = ['emails', 'folders', 'attachments', 'rules'];
      for (const table of tables) {
        await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      }
      
      await initializeDatabase(env);
      
      return new Response(JSON.stringify({
        success: true,
        message: "数据库已重置并重新初始化"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "重置数据库失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 获取统计信息
  async getStats(request, env) {
    try {
      const totalResult = await env.DB.prepare(
        "SELECT COUNT(*) as total FROM emails WHERE is_deleted = 0"
      ).first();
      
      const unreadResult = await env.DB.prepare(
        "SELECT COUNT(*) as unread FROM emails WHERE is_read = 0 AND is_deleted = 0 AND folder_id = 1"
      ).first();
      
      const spamResult = await env.DB.prepare(
        "SELECT COUNT(*) as spam FROM emails WHERE folder_id = 3 AND is_deleted = 0"
      ).first();
      
      return new Response(JSON.stringify({
        success: true,
        stats: {
          total: totalResult?.total || 0,
          unread: unreadResult?.unread || 0,
          spam: spamResult?.spam || 0
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取统计失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 返回管理界面
  async getAdminInterface(request, env) {
    const authResult = await this.checkAuth(request, env);
    const isLoggedIn = authResult.authenticated;
    
    const dbStatus = await checkDatabaseStatus(env);
    
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>邮件管理系统</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .tabs {
            display: flex;
            margin-bottom: 20px;
            border-bottom: 1px solid #ddd;
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border: 1px solid transparent;
            border-bottom: none;
            border-radius: 4px 4px 0 0;
            margin-right: 5px;
        }
        .tab.active {
            background: #007cba;
            color: white;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .email-item {
            border: 1px solid #ddd;
            padding: 15px;
            margin: 10px 0;
            border-radius: 4px;
            background: #f9f9f9;
        }
        .email-item.unread {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
        }
        .email-item.spam {
            background: #ffebee;
            border-left: 4px solid #f44336;
        }
        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        .stat-card {
            flex: 1;
            padding: 15px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            text-align: center;
        }
        .debug-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 4px;
            margin: 10px 0;
        }
        button {
            background: #007cba;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
        }
        button:hover {
            background: #005a87;
        }
        button.danger {
            background: #f44336;
        }
        button.success {
            background: #4caf50;
        }
        button.warning {
            background: #ff9800;
        }
        .hidden {
            display: none;
        }
        input, textarea {
            width: 100%;
            padding: 8px;
            margin: 5px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        textarea {
            height: 120px;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 登录界面 -->
        <div id="login-section" ${isLoggedIn ? 'class="hidden"' : ''}>
            <h1>邮件管理系统</h1>
            <div>
                <h2>管理员登录</h2>
                <input type="text" id="username" placeholder="用户名" value="admin">
                <input type="password" id="password" placeholder="密码" value="1591156135qwzxcv">
                <button onclick="login()">登录</button>
                <div id="login-message"></div>
                ${!dbStatus.initialized ? '<div class="debug-info"><p>数据库未初始化</p><button onclick="resetDatabase()">初始化数据库</button></div>' : ''}
            </div>
        </div>

        <!-- 主界面 -->
        <div id="admin-interface" ${isLoggedIn ? '' : 'class="hidden"'}>
            <h1>邮件管理系统</h1>
            
            <!-- 调试信息 -->
            <div class="debug-info">
                <button onclick="loadDebugInfo()">刷新调试信息</button>
                <div id="debug-info"></div>
            </div>

            <!-- 统计信息 -->
            <div class="stats" id="stats-container">
                <div class="stat-card">
                    <h3>总邮件</h3>
                    <p id="total-emails">0</p>
                </div>
                <div class="stat-card">
                    <h3>未读邮件</h3>
                    <p id="unread-emails">0</p>
                </div>
                <div class="stat-card">
                    <h3>垃圾邮件</h3>
                    <p id="spam-emails">0</p>
                </div>
            </div>

            <div class="tabs">
                <div class="tab active" onclick="showTab('inbox')">收件箱</div>
                <div class="tab" onclick="showTab('spam')">垃圾邮件</div>
                <div class="tab" onclick="showTab('send')">发送邮件</div>
                <div class="tab" onclick="showTab('settings')">设置</div>
            </div>

            <!-- 收件箱 -->
            <div id="tab-inbox" class="tab-content active">
                <button onclick="loadEmails(1)">刷新收件箱</button>
                <div id="inbox-list"></div>
            </div>

            <!-- 垃圾邮件 -->
            <div id="tab-spam" class="tab-content">
                <button onclick="loadEmails(3)">刷新垃圾邮件</button>
                <div id="spam-list"></div>
            </div>

            <!-- 发送邮件 -->
            <div id="tab-send" class="tab-content">
                <div>
                    <strong>发件人:</strong> 
                    <input type="text" id="fromUser" placeholder="发件人名称" value="sak" style="width: 100px;">
                    <span>@ilqx.dpdns.org</span>
                </div>
                <input type="email" id="to" placeholder="收件人邮箱">
                <input type="text" id="subject" placeholder="邮件主题">
                <textarea id="body" placeholder="邮件内容"></textarea>
                <button onclick="sendEmail()">发送邮件</button>
                <div id="send-message"></div>
            </div>

            <!-- 设置 -->
            <div id="tab-settings" class="tab-content">
                <button onclick="resetDatabase()" class="danger">重置数据库</button>
                <button onclick="logout()">退出登录</button>
            </div>
        </div>
    </div>

    <script>
        let currentFolder = 1;
        
        document.addEventListener('DOMContentLoaded', function() {
            if (!document.getElementById('admin-interface').classList.contains('hidden')) {
                initializeApp();
            }
        });

        async function initializeApp() {
            await loadDebugInfo();
            await loadStats();
            await loadEmails(1);
        }

        async function loadDebugInfo() {
            try {
                const response = await fetch('/api/debug');
                const result = await response.json();
                if (result.success) {
                    const debugInfo = document.getElementById('debug-info');
                    debugInfo.innerHTML = \`
                        <p><strong>数据库表:</strong> \${JSON.stringify(result.debug.tables)}</p>
                        <p><strong>邮件总数:</strong> \${result.debug.emailCount}</p>
                        <p><strong>文件夹:</strong> \${JSON.stringify(result.debug.folders)}</p>
                        <p><strong>更新时间:</strong> \${result.debug.timestamp}</p>
                    \`;
                }
            } catch (error) {
                document.getElementById('debug-info').innerHTML = '加载调试信息失败: ' + error.message;
            }
        }

        async function loadStats() {
            try {
                const response = await fetch('/api/stats');
                const result = await response.json();
                if (result.success) {
                    document.getElementById('total-emails').textContent = result.stats.total;
                    document.getElementById('unread-emails').textContent = result.stats.unread;
                    document.getElementById('spam-emails').textContent = result.stats.spam;
                }
            } catch (error) {
                console.error('加载统计失败:', error);
            }
        }

        async function loadEmails(folderId) {
            currentFolder = folderId;
            const listId = folderId === 3 ? 'spam-list' : 'inbox-list';
            const listElement = document.getElementById(listId);
            listElement.innerHTML = '加载中...';

            try {
                const response = await fetch('/api/emails?folder=' + folderId);
                if (response.status === 401) {
                    logout();
                    return;
                }
                const result = await response.json();
                
                if (result.success) {
                    renderEmails(result.emails, listId, folderId);
                    await loadStats();
                    await loadDebugInfo();
                } else {
                    listElement.innerHTML = '加载失败: ' + result.message;
                }
            } catch (error) {
                listElement.innerHTML = '请求失败: ' + error.message;
            }
        }

        function renderEmails(emails, listId, folderId) {
            const listElement = document.getElementById(listId);
            
            if (emails.length === 0) {
                listElement.innerHTML = '<p>没有邮件</p>';
                return;
            }

            listElement.innerHTML = emails.map(email => {
                const emailClass = folderId === 3 ? 'email-item spam' : 
                                 email.is_read ? 'email-item' : 'email-item unread';
                return \`
                    <div class="\${emailClass}">
                        <div><strong>发件人:</strong> \${escapeHtml(email.sender)}</div>
                        <div><strong>主题:</strong> \${escapeHtml(email.subject)}</div>
                        <div><strong>时间:</strong> \${new Date(email.received_at).toLocaleString()}</div>
                        <div>
                            <button onclick="markEmailRead(\${email.id}, \${email.is_read ? 'false' : 'true'})">
                                \${email.is_read ? '标记未读' : '标记已读'}
                            </button>
                            \${folderId === 3 ? 
                                '<button onclick="markEmailSpam(' + email.id + ', false)" class="success">不是垃圾邮件</button>' : 
                                '<button onclick="markEmailSpam(' + email.id + ', true)" class="danger">标记垃圾邮件</button>'
                            }
                            <button onclick="deleteEmail(\${email.id})" class="danger">删除</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        async function markEmailSpam(emailId, isSpam) {
            try {
                const response = await fetch('/api/emails/mark-spam', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id: emailId, isSpam: isSpam })
                });
                const result = await response.json();
                if (result.success) {
                    await loadEmails(currentFolder);
                } else {
                    alert('操作失败: ' + result.message);
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }

        async function markEmailRead(emailId, read) {
            try {
                const response = await fetch('/api/emails/mark-read', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id: emailId, read: read })
                });
                const result = await response.json();
                if (result.success) {
                    await loadEmails(currentFolder);
                } else {
                    alert('操作失败: ' + result.message);
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }

        async function deleteEmail(emailId) {
            if (!confirm('确定要删除这封邮件吗？')) return;
            
            try {
                const response = await fetch('/api/emails/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id: emailId, permanent: false })
                });
                const result = await response.json();
                if (result.success) {
                    alert(result.message);
                    await loadEmails(currentFolder);
                } else {
                    alert('删除失败: ' + result.message);
                }
            } catch (error) {
                alert('删除请求失败: ' + error.message);
            }
        }

        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.add('active');
            event.target.classList.add('active');
            
            if (tabName === 'inbox') loadEmails(1);
            if (tabName === 'spam') loadEmails(3);
        }

        async function login() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const messageDiv = document.getElementById('login-message');
            
            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    messageDiv.textContent = '登录成功！';
                    messageDiv.style.color = 'green';
                    setTimeout(() => {
                        document.getElementById('login-section').classList.add('hidden');
                        document.getElementById('admin-interface').classList.remove('hidden');
                        initializeApp();
                    }, 1000);
                } else {
                    messageDiv.textContent = result.message || '登录失败';
                    messageDiv.style.color = 'red';
                }
            } catch (error) {
                messageDiv.textContent = '登录请求失败: ' + error.message;
                messageDiv.style.color = 'red';
            }
        }

        async function logout() {
            try {
                await fetch('/logout', { method: 'POST' });
                document.getElementById('admin-interface').classList.add('hidden');
                document.getElementById('login-section').classList.remove('hidden');
                document.getElementById('password').value = '1591156135qwzxcv';
                document.getElementById('login-message').textContent = '';
            } catch (error) {
                console.error('退出登录错误:', error);
                document.getElementById('admin-interface').classList.add('hidden');
                document.getElementById('login-section').classList.remove('hidden');
            }
        }

        async function sendEmail() {
            const to = document.getElementById('to').value;
            const subject = document.getElementById('subject').value;
            const body = document.getElementById('body').value;
            const fromUser = document.getElementById('fromUser').value || 'sak';
            const messageDiv = document.getElementById('send-message');
            
            if (!to || !subject || !body) {
                messageDiv.textContent = '请填写完整的收件人、主题和内容';
                messageDiv.style.color = 'red';
                return;
            }
            
            try {
                const response = await fetch('/api/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ to, subject, text: body, fromUser })
                });
                
                if (response.status === 401) {
                    logout();
                    return;
                }
                
                const result = await response.json();
                
                if (result.success) {
                    messageDiv.textContent = '邮件发送成功!';
                    messageDiv.style.color = 'green';
                    document.getElementById('to').value = '';
                    document.getElementById('subject').value = '';
                    document.getElementById('body').value = '';
                    setTimeout(() => {
                        messageDiv.textContent = '';
                    }, 3000);
                } else {
                    messageDiv.textContent = '发送失败: ' + (result.message || '未知错误');
                    messageDiv.style.color = 'red';
                }
            } catch (error) {
                messageDiv.textContent = '发送请求失败: ' + error.message;
                messageDiv.style.color = 'red';
            }
        }

        async function resetDatabase() {
            if (!confirm('确定要重置数据库吗？这将删除所有数据并重新初始化数据库。此操作不可撤销！')) return;
            
            try {
                const response = await fetch('/api/db/reset', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    alert('数据库已重置');
                    if (document.getElementById('admin-interface').classList.contains('hidden')) {
                        location.reload();
                    } else {
                        await initializeApp();
                    }
                } else {
                    alert('重置失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
};

// 数据库初始化函数
async function initializeDatabase(env) {
  try {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='folders'"
    ).first();
    
    if (tables) {
      console.log('数据库已初始化');
      return;
    }

    console.log("初始化数据库...");
    
    // 创建文件夹表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 创建邮件表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        html_body TEXT,
        is_read BOOLEAN DEFAULT 0,
        is_spam BOOLEAN DEFAULT 0,
        is_deleted BOOLEAN DEFAULT 0,
        has_attachments BOOLEAN DEFAULT 0,
        folder_id INTEGER DEFAULT 1,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 创建附件表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT,
        content BLOB,
        size INTEGER
      )
    `).run();
    
    // 创建规则表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        action TEXT NOT NULL,
        target_folder_id INTEGER,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 插入默认文件夹
    const defaultFolders = [
      { id: 1, name: '收件箱' },
      { id: 2, name: '已发送' },
      { id: 3, name: '垃圾邮件' },
      { id: 4, name: '已删除' }
    ];
    
    for (const folder of defaultFolders) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO folders (id, name) VALUES (?, ?)"
      ).bind(folder.id, folder.name).run();
    }
    
    console.log("数据库初始化完成");
  } catch (error) {
    console.error("数据库初始化错误:", error);
    throw error;
  }
}

// 保存邮件到数据库的辅助函数
async function saveEmailToDatabase(env, from, to, subject, text, html, folderId, isSpam) {
  try {
    console.log('保存邮件到数据库...', { from, to, subject: subject.substring(0, 50), folderId, isSpam });
    
    const result = await env.DB.prepare(
      "INSERT INTO emails (sender, recipient, subject, body, html_body, folder_id, is_spam, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(from, to, subject, text, html || '', folderId, isSpam, new Date().toISOString()).run();
    
    console.log('✅ 邮件保存成功，ID:', result.meta.last_row_id);
    return result;
  } catch (error) {
    console.error('❌ 保存邮件失败:', error);
    throw error;
  }
}

// 检查数据库状态
async function checkDatabaseStatus(env) {
  try {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='folders'"
    ).first();
    
    return {
      initialized: !!tables,
      message: tables ? "数据库已初始化" : "数据库未初始化"
    };
  } catch (error) {
    return {
      initialized: false,
      message: "数据库检查失败: " + error.message
    };
  }
}

// 检查拦截规则
async function checkBlockRules(from, subject, body, env) {
  try {
    const rules = await env.DB.prepare(
      "SELECT type, value, action, target_folder_id FROM rules WHERE is_active = 1"
    ).all();
    
    for (const rule of rules.results) {
      let matches = false;
      
      switch (rule.type) {
        case 'sender':
          matches = from.includes(rule.value);
          break;
        case 'subject':
          matches = subject.includes(rule.value);
          break;
        case 'content':
          matches = body.includes(rule.value);
          break;
      }
      
      if (matches) {
        console.log(`邮件匹配拦截规则: ${rule.type} = ${rule.value}`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error("检查拦截规则错误:", error);
    return false;
  }
}