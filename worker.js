// 完整的邮件管理系统 Worker
export default {
  async email(message, env, ctx) {
    try {
      // 初始化数据库
      await initializeDatabase(env);
      
      const from = message.from;
      const to = message.to;
      const subject = message.headers.get("subject") || "无主题";
      const text = await message.text();
      const html = await message.html();
      
      console.log(`收到邮件: ${from} -> ${to}, 主题: ${subject}`);
      
      // 检查拦截规则
      const shouldBlock = await checkBlockRules(from, subject, text, env);
      if (shouldBlock) {
        console.log(`邮件被拦截: ${from} -> ${to}`);
        return;
      }
      
      // 存储邮件到数据库
      const result = await env.DB.prepare(
        "INSERT INTO emails (sender, recipient, subject, body, html_body, folder_id, has_attachments, received_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
      ).bind(from, to, subject, text, html, 0, new Date().toISOString()).run();
      
      console.log(`邮件已存储，ID: ${result.meta.last_row_id}`);
      
      // 处理附件
      const attachments = message.attachments;
      if (attachments && attachments.length > 0) {
        console.log(`处理 ${attachments.length} 个附件`);
        for (const attachment of attachments) {
          await storeAttachment(result.meta.last_row_id, attachment, env);
        }
        
        // 更新邮件标记为有附件
        await env.DB.prepare(
          "UPDATE emails SET has_attachments = 1 WHERE id = ?"
        ).bind(result.meta.last_row_id).run();
      }
      
    } catch (error) {
      console.error("处理邮件时出错:", error);
    }
  },

  async fetch(request, env, ctx) {
    // 初始化数据库
    await initializeDatabase(env);
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // API 路由
    const routes = {
      'POST:/login': () => this.handleLogin(request, env),
      'POST:/logout': () => this.handleLogout(),
      'GET:/api/emails': () => this.getEmails(request, env),
      'POST:/api/emails/delete': () => this.deleteEmail(request, env),
      'POST:/api/emails/move': () => this.moveEmail(request, env),
      'POST:/api/emails/mark-read': () => this.markEmailRead(request, env),
      'POST:/api/send': () => this.sendEmail(request, env),
      'GET:/api/folders': () => this.getFolders(request, env),
      'POST:/api/folders': () => this.createFolder(request, env),
      'POST:/api/folders/delete': () => this.deleteFolder(request, env),
      'GET:/api/rules': () => this.getRules(request, env),
      'POST:/api/rules': () => this.createRule(request, env),
      'POST:/api/rules/delete': () => this.deleteRule(request, env),
      'POST:/api/db/reset': () => this.resetDatabase(request, env),
      'GET:/api/attachments': () => this.getAttachments(request, env),
    };
    
    const routeKey = `${request.method}:${path}`;
    if (routes[routeKey]) {
      // 检查认证（除了登录和重置数据库）
      if (!['POST:/login', 'POST:/api/db/reset'].includes(routeKey)) {
        const authResult = await this.checkAuth(request, env);
        if (!authResult.authenticated) {
          return new Response(JSON.stringify({ success: false, message: "未登录" }), { status: 401 });
        }
      }
      return await routes[routeKey]();
    }
    
    // 默认返回管理界面
    return this.getAdminInterface(request, env);
  },

  // 检查认证状态
  async checkAuth(request, env) {
    try {
      const cookieHeader = request.headers.get('Cookie');
      if (!cookieHeader) return { authenticated: false };
      
      const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
      const sessionToken = cookies['mail_session'];
      
      if (!sessionToken) return { authenticated: false };
      
      // 验证会话令牌
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
      
      // 硬编码的用户名和密码
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
        // 永久删除
        await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM attachments WHERE email_id = ?").bind(id).run();
      } else {
        // 移动到已删除文件夹
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
        await env.DB.prepare(
          "INSERT INTO emails (sender, recipient, subject, body, folder_id, received_at) VALUES (?, ?, ?, ?, 2, ?)"
        ).bind(from, to, subject, text, new Date().toISOString()).run();
        
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
      
      // 将文件夹中的邮件移动到收件箱
      await env.DB.prepare("UPDATE emails SET folder_id = 1 WHERE folder_id = ?").bind(id).run();
      
      // 删除文件夹
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
      // 删除所有表
      const tables = ['emails', 'folders', 'attachments', 'rules'];
      for (const table of tables) {
        await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      }
      
      // 重新初始化
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

  // 获取附件
  async getAttachments(request, env) {
    try {
      const url = new URL(request.url);
      const emailId = url.searchParams.get('email_id');
      
      const result = await env.DB.prepare(
        "SELECT id, filename, content_type, size FROM attachments WHERE email_id = ?"
      ).bind(emailId).all();
      
      return new Response(JSON.stringify({
        success: true,
        attachments: result.results || []
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取附件失败: " + error.message 
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
    
    // 检查数据库状态
    const dbStatus = await checkDatabaseStatus(env);
    
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>邮件管理系统</title>
    <style>
        /* 基础样式 - 玻璃效果 */
        html, body {
            height: 100%;
            margin: 0;
            overflow: auto;
            background-color: #e0f7fa;
        }
        body {
            font-family: 'Roboto', Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            color: #333333;
            background-image: url('https://www.loliapi.com/acg/');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            position: relative;
            overflow: hidden;
            filter: none;
        }
        body::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: inherit;
            background-size: cover;
            background-position: center;
            filter: blur(8px);
            z-index: -2;
        }
        body::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, rgba(79, 195, 247, 0.2), rgba(176, 196, 222, 0.2));
            z-index: -1;
        }
        
        /* 内容容器 */
        .content {
            text-align: center;
            max-width: 95%;
            width: 100%;
            padding: 20px;
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(79, 195, 247, 0.3), 0 0 10px rgba(176, 196, 222, 0.2);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(79, 195, 247, 0.3);
            transform: scale(0.5);
            opacity: 0.5;
            filter: blur(10px);
            transition: transform 1s ease-out, opacity 1s ease-out, filter 1s ease-out;
            position: relative;
            z-index: 1;
            margin: 10px;
            box-sizing: border-box;
            overflow: hidden;
        }
        .content.loaded {
            transform: scale(1);
            opacity: 1;
            filter: blur(0);
        }
        .content:hover {
            transform: scale(1.03);
            box-shadow: 0 12px 40px rgba(79, 195, 247, 0.5), 0 0 20px rgba(176, 196, 222, 0.3);
        }
        
        /* 移动端优化 */
        @media (max-width: 768px) {
            .content {
                max-width: 98%;
                padding: 15px;
                margin: 5px;
            }
            body {
                justify-content: flex-start;
                padding: 10px 0;
            }
        }
        
        /* 标签页样式 */
        .tabs {
            display: flex;
            flex-wrap: wrap;
            margin-bottom: 20px;
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            background: rgba(255, 255, 255, 0.3);
            border: 1px solid rgba(79, 195, 247, 0.3);
            border-bottom: none;
            border-radius: 8px 8px 0 0;
            margin-right: 5px;
            margin-bottom: -1px;
        }
        .tab.active {
            background: rgba(79, 195, 247, 0.3);
            font-weight: bold;
        }
        
        /* 邮件列表样式 */
        .email-list {
            max-height: 500px;
            overflow-y: auto;
            margin: 20px 0;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            padding: 10px;
        }
        .email-item {
            background: rgba(255, 255, 255, 0.3);
            margin: 10px 0;
            padding: 15px;
            border-radius: 10px;
            border-left: 4px solid #4fc3f7;
            text-align: left;
            word-break: break-word;
            transition: all 0.3s ease;
        }
        .email-item.unread {
            border-left-color: #ff5722;
            background: rgba(255, 87, 34, 0.1);
        }
        .email-item:hover {
            transform: translateX(5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .email-actions {
            margin-top: 10px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        /* 按钮样式 */
        button {
            margin: 10px auto;
            padding: 12px 15px;
            font-size: 16px;
            border-radius: 25px;
            outline: none;
            display: block;
            width: 90%;
            max-width: 400px;
            transition: all 0.3s ease;
            box-sizing: border-box;
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            color: #333333;
            cursor: pointer;
            font-weight: bold;
            letter-spacing: 1px;
        }
        button:hover {
            background: linear-gradient(45deg, #29b6f6, #4fc3f7);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 195, 247, 0.4);
        }
        button.small {
            width: auto;
            padding: 8px 15px;
            font-size: 14px;
            margin: 5px;
        }
        button.danger {
            background: linear-gradient(45deg, #f44336, #e57373);
        }
        button.success {
            background: linear-gradient(45deg, #4caf50, #81c784);
        }
        
        /* 输入框样式 */
        input, textarea, select {
            margin: 10px auto;
            padding: 12px 15px;
            font-size: 16px;
            border-radius: 25px;
            outline: none;
            display: block;
            width: 90%;
            max-width: 400px;
            transition: all 0.3s ease;
            box-sizing: border-box;
            background-color: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(79, 195, 247, 0.5);
            color: #333333;
            text-align: center;
        }
        textarea {
            text-align: left;
            min-height: 120px;
            resize: vertical;
        }
        input:focus, textarea:focus, select:focus {
            background-color: rgba(255, 255, 255, 0.7);
            border-color: #0277bd;
            box-shadow: 0 0 10px rgba(79, 195, 247, 0.3);
        }
        
        /* 其他样式 */
        .hidden {
            display: none !important;
        }
        .section {
            margin: 20px 0;
            padding: 15px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            width: 100%;
            box-sizing: border-box;
        }
        .message {
            padding: 10px;
            margin: 10px 0;
            border-radius: 10px;
            text-align: center;
        }
        .success {
            background: rgba(76, 175, 80, 0.3);
            color: #2e7d32;
        }
        .error {
            background: rgba(244, 67, 54, 0.3);
            color: #c62828;
        }
        .warning {
            background: rgba(255, 152, 0, 0.3);
            color: #ef6c00;
        }
        .form-group {
            margin: 15px 0;
            text-align: left;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #0277bd;
        }
        .sender-display {
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 10px 0;
        }
        .sender-input {
            border-radius: 25px 0 0 25px !important;
            width: 30% !important;
            margin: 0 !important;
            text-align: center;
        }
        .domain-display {
            background: rgba(255, 255, 255, 0.5);
            padding: 12px 15px;
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-left: none;
            border-radius: 0 25px 25px 0;
            color: #333;
        }
        
        /* 加载动画 */
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        /* 分页样式 */
        .pagination {
            display: flex;
            justify-content: center;
            margin: 20px 0;
            flex-wrap: wrap;
        }
        .page-btn {
            margin: 5px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.3);
            border: 1px solid rgba(79, 195, 247, 0.3);
            border-radius: 5px;
            cursor: pointer;
        }
        .page-btn.active {
            background: rgba(79, 195, 247, 0.3);
            font-weight: bold;
        }
        
        /* 文件夹样式 */
        .folders {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin: 15px 0;
        }
        .folder {
            padding: 10px 15px;
            background: rgba(255, 255, 255, 0.3);
            border: 1px solid rgba(79, 195, 247, 0.3);
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .folder.active {
            background: rgba(79, 195, 247, 0.3);
            font-weight: bold;
        }
        .folder:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        /* 规则列表 */
        .rule-item {
            background: rgba(255, 255, 255, 0.3);
            margin: 10px 0;
            padding: 15px;
            border-radius: 10px;
            border-left: 4px solid #4caf50;
            text-align: left;
        }
    </style>
</head>
<body>
    <!-- 登录页面 -->
    <div id="login-section" class="content ${isLoggedIn ? 'hidden' : ''}">
        <h1>邮件管理系统</h1>
        <div class="section">
            <h2>管理员登录</h2>
            <input type="text" id="username" placeholder="用户名" value="admin">
            <input type="password" id="password" placeholder="密码" value="1591156135qwzxcv">
            <button onclick="login()">登录</button>
            <div id="login-message" class="message"></div>
            
            ${!dbStatus.initialized ? `
            <div class="message warning">
                <p>数据库未初始化</p>
                <button onclick="resetDatabase()" class="small">初始化数据库</button>
            </div>
            ` : ''}
        </div>
    </div>

    <!-- 管理主界面 -->
    <div id="admin-interface" class="content ${isLoggedIn ? '' : 'hidden'}">
        <h1>邮件管理系统</h1>
        
        <!-- 标签页导航 -->
        <div class="tabs">
            <div class="tab active" onclick="showTab('mail')">邮件</div>
            <div class="tab" onclick="showTab('send')">发送邮件</div>
            <div class="tab" onclick="showTab('folders')">文件夹</div>
            <div class="tab" onclick="showTab('rules')">拦截规则</div>
            <div class="tab" onclick="showTab('settings')">设置</div>
        </div>
        
        <!-- 邮件标签页 -->
        <div id="tab-mail" class="tab-content">
            <!-- 文件夹导航 -->
            <div class="section">
                <h2>文件夹</h2>
                <div id="folders-list" class="folders">
                    <!-- 文件夹将通过JS动态加载 -->
                </div>
            </div>
            
            <!-- 邮件列表 -->
            <div class="section">
                <h2 id="folder-title">收件箱</h2>
                <button onclick="loadEmails(currentFolder)">刷新邮件列表</button>
                <div id="mail-list" class="email-list">
                    <div class="message">加载中...</div>
                </div>
                
                <!-- 分页 -->
                <div id="pagination" class="pagination"></div>
            </div>
        </div>
        
        <!-- 发送邮件标签页 -->
        <div id="tab-send" class="tab-content hidden">
            <div class="section">
                <h2>发送邮件</h2>
                <div class="form-group">
                    <label for="fromUser">发件人:</label>
                    <div class="sender-display">
                        <input type="text" id="fromUser" class="sender-input" placeholder="sak" value="sak">
                        <div class="domain-display">@ilqx.dpdns.org</div>
                    </div>
                    <small>自定义发件人名称部分</small>
                </div>
                <div class="form-group">
                    <label for="to">收件人:</label>
                    <input type="email" id="to" placeholder="收件人邮箱地址">
                </div>
                <div class="form-group">
                    <label for="subject">主题:</label>
                    <input type="text" id="subject" placeholder="邮件主题">
                </div>
                <div class="form-group">
                    <label for="body">内容:</label>
                    <textarea id="body" placeholder="邮件内容"></textarea>
                </div>
                <button onclick="sendEmail()">发送邮件</button>
                <button onclick="clearForm()">清空</button>
                <div id="send-message" class="message"></div>
            </div>
        </div>
        
        <!-- 文件夹管理标签页 -->
        <div id="tab-folders" class="tab-content hidden">
            <div class="section">
                <h2>文件夹管理</h2>
                <div class="form-group">
                    <label for="new-folder-name">新建文件夹:</label>
                    <input type="text" id="new-folder-name" placeholder="文件夹名称">
                    <button onclick="createFolder()" class="small">创建文件夹</button>
                </div>
                <div id="custom-folders-list">
                    <!-- 自定义文件夹将通过JS动态加载 -->
                </div>
            </div>
        </div>
        
        <!-- 拦截规则标签页 -->
        <div id="tab-rules" class="tab-content hidden">
            <div class="section">
                <h2>拦截规则</h2>
                <div class="form-group">
                    <label for="rule-name">规则名称:</label>
                    <input type="text" id="rule-name" placeholder="规则名称">
                </div>
                <div class="form-group">
                    <label for="rule-type">规则类型:</label>
                    <select id="rule-type">
                        <option value="sender">发件人</option>
                        <option value="subject">主题</option>
                        <option value="content">内容</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="rule-value">规则值:</label>
                    <input type="text" id="rule-value" placeholder="例如: spam@example.com">
                </div>
                <div class="form-group">
                    <label for="rule-action">执行操作:</label>
                    <select id="rule-action">
                        <option value="move">移动到文件夹</option>
                        <option value="delete">直接删除</option>
                    </select>
                </div>
                <div class="form-group" id="target-folder-group">
                    <label for="rule-target-folder">目标文件夹:</label>
                    <select id="rule-target-folder">
                        <!-- 文件夹选项将通过JS动态加载 -->
                    </select>
                </div>
                <button onclick="createRule()">创建规则</button>
                <div id="rules-list">
                    <!-- 规则将通过JS动态加载 -->
                </div>
            </div>
        </div>
        
        <!-- 设置标签页 -->
        <div id="tab-settings" class="tab-content hidden">
            <div class="section">
                <h2>系统设置</h2>
                <button onclick="resetDatabase()" class="danger">重置数据库</button>
                <p><small>警告: 这将删除所有邮件、文件夹和规则</small></p>
            </div>
        </div>

        <button onclick="logout()" class="logout-btn danger">退出登录</button>
    </div>

    <script>
        // 全局变量
        let currentFolder = 1;
        let currentPage = 1;
        let folders = [];
        let rules = [];
        
        // 页面加载动画
        document.addEventListener('DOMContentLoaded', function() {
            var contents = document.querySelectorAll('.content');
            setTimeout(function() {
                contents.forEach(content => {
                    content.classList.add('loaded');
                });
            }, 100);
            
            if (document.getElementById('admin-interface').classList.contains('hidden') === false) {
                initializeApp();
            }
        });
        
        // 初始化应用
        async function initializeApp() {
            await loadFolders();
            await loadRules();
            await loadEmails(currentFolder);
        }
        
        // 显示标签页
        function showTab(tabName) {
            // 隐藏所有标签页内容
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.add('hidden');
            });
            
            // 移除所有标签页的活动状态
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // 显示选中的标签页
            document.getElementById('tab-' + tabName).classList.remove('hidden');
            
            // 设置选中的标签页为活动状态
            event.target.classList.add('active');
            
            // 如果是规则标签页，加载目标文件夹选项
            if (tabName === 'rules') {
                loadTargetFolderOptions();
            }
        }
        
        // 登录函数
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
                    messageDiv.className = 'message success';
                    setTimeout(() => {
                        document.getElementById('login-section').classList.add('hidden');
                        document.getElementById('admin-interface').classList.remove('hidden');
                        initializeApp();
                    }, 1000);
                } else {
                    messageDiv.textContent = result.message || '登录失败';
                    messageDiv.className = 'message error';
                }
            } catch (error) {
                messageDiv.textContent = '登录请求失败: ' + error.message;
                messageDiv.className = 'message error';
            }
        }
        
        // 退出登录
        async function logout() {
            try {
                const response = await fetch('/logout', { method: 'POST' });
                document.getElementById('admin-interface').classList.add('hidden');
                document.getElementById('login-section').classList.remove('hidden');
                document.getElementById('password').value = '1591156135qwzxcv';
                document.getElementById('login-message').textContent = '';
            } catch (error) {
                console.error('退出登录错误:', error);
                // 即使请求失败，也强制前端退出
                document.getElementById('admin-interface').classList.add('hidden');
                document.getElementById('login-section').classList.remove('hidden');
            }
        }
        
        // 加载文件夹
        async function loadFolders() {
            try {
                const response = await fetch('/api/folders');
                const result = await response.json();
                
                if (result.success) {
                    folders = result.folders;
                    renderFolders();
                    renderCustomFolders();
                } else {
                    console.error('加载文件夹失败:', result.message);
                }
            } catch (error) {
                console.error('加载文件夹请求失败:', error);
            }
        }
        
        // 渲染文件夹
        function renderFolders() {
            const foldersList = document.getElementById('folders-list');
            foldersList.innerHTML = '';
            
            folders.forEach(folder => {
                const folderElement = document.createElement('div');
                folderElement.className = `folder ${folder.id == currentFolder ? 'active' : ''}`;
                folderElement.textContent = folder.name;
                folderElement.onclick = () => {
                    currentFolder = folder.id;
                    currentPage = 1;
                    document.getElementById('folder-title').textContent = folder.name;
                    loadEmails(folder.id);
                    // 更新活动文件夹样式
                    document.querySelectorAll('.folder').forEach(f => f.classList.remove('active'));
                    folderElement.classList.add('active');
                };
                foldersList.appendChild(folderElement);
            });
        }
        
        // 渲染自定义文件夹（用于管理）
        function renderCustomFolders() {
            const customFoldersList = document.getElementById('custom-folders-list');
            customFoldersList.innerHTML = '<h3>自定义文件夹</h3>';
            
            const customFolders = folders.filter(f => f.id > 4);
            
            if (customFolders.length === 0) {
                customFoldersList.innerHTML += '<p>暂无自定义文件夹</p>';
                return;
            }
            
            customFolders.forEach(folder => {
                const folderElement = document.createElement('div');
                folderElement.className = 'folder-item';
                folderElement.innerHTML = \`
                    <strong>\${folder.name}</strong>
                    <button onclick="deleteFolder(\${folder.id})" class="small danger">删除</button>
                \`;
                customFoldersList.appendChild(folderElement);
            });
        }
        
        // 加载邮件列表
        async function loadEmails(folderId) {
            const mailList = document.getElementById('mail-list');
            mailList.innerHTML = '<div class="message">加载中...</div>';
            
            try {
                const response = await fetch(\`/api/emails?folder=\${folderId}&page=\${currentPage}\`);
                if (response.status === 401) {
                    logout();
                    return;
                }
                
                const result = await response.json();
                
                if (result.success) {
                    renderEmails(result.emails, result.pagination);
                } else {
                    mailList.innerHTML = \`<div class="message error">加载失败: \${result.message || '未知错误'}</div>\`;
                }
            } catch (error) {
                mailList.innerHTML = \`<div class="message error">请求失败: \${error.message}</div>\`;
            }
        }
        
        // 渲染邮件列表
        function renderEmails(emails, pagination) {
            const mailList = document.getElementById('mail-list');
            
            if (emails.length === 0) {
                mailList.innerHTML = '<div class="message">该文件夹为空</div>';
                document.getElementById('pagination').innerHTML = '';
                return;
            }
            
            mailList.innerHTML = emails.map(email => \`
                <div class="email-item \${email.is_read ? '' : 'unread'}" onclick="viewEmail(\${email.id})">
                    <div class="email-sender"><strong>发件人:</strong> \${escapeHtml(email.sender)}</div>
                    <div class="email-subject"><strong>主题:</strong> \${escapeHtml(email.subject)}</div>
                    <div class="email-preview">\${escapeHtml(email.body ? email.body.substring(0, 100) : '无内容')}\${email.body && email.body.length > 100 ? '...' : ''}</div>
                    <div class="email-date">\${new Date(email.received_at).toLocaleString()}</div>
                    <div class="email-actions">
                        <button onclick="event.stopPropagation(); markEmailRead(\${email.id}, \${email.is_read ? 'false' : 'true'})" class="small">
                            \${email.is_read ? '标记未读' : '标记已读'}
                        </button>
                        <button onclick="event.stopPropagation(); moveEmailPrompt(\${email.id})" class="small">移动到</button>
                        <button onclick="event.stopPropagation(); deleteEmail(\${email.id})" class="small danger">删除</button>
                    </div>
                </div>
            \`).join('');
            
            renderPagination(pagination);
        }
        
        // 渲染分页
        function renderPagination(pagination) {
            const paginationElement = document.getElementById('pagination');
            paginationElement.innerHTML = '';
            
            if (pagination.totalPages <= 1) return;
            
            // 上一页按钮
            if (currentPage > 1) {
                const prevButton = document.createElement('div');
                prevButton.className = 'page-btn';
                prevButton.textContent = '上一页';
                prevButton.onclick = () => {
                    currentPage--;
                    loadEmails(currentFolder);
                };
                paginationElement.appendChild(prevButton);
            }
            
            // 页码按钮
            for (let i = 1; i <= pagination.totalPages; i++) {
                const pageButton = document.createElement('div');
                pageButton.className = \`page-btn \${i === currentPage ? 'active' : ''}\`;
                pageButton.textContent = i;
                pageButton.onclick = () => {
                    currentPage = i;
                    loadEmails(currentFolder);
                };
                paginationElement.appendChild(pageButton);
            }
            
            // 下一页按钮
            if (currentPage < pagination.totalPages) {
                const nextButton = document.createElement('div');
                nextButton.className = 'page-btn';
                nextButton.textContent = '下一页';
                nextButton.onclick = () => {
                    currentPage++;
                    loadEmails(currentFolder);
                };
                paginationElement.appendChild(nextButton);
            }
        }
        
        // 查看邮件详情
        function viewEmail(emailId) {
            // 这里可以实现查看邮件详情的功能
            alert('查看邮件详情功能待实现 - 邮件ID: ' + emailId);
        }
        
        // 标记邮件已读/未读
        async function markEmailRead(emailId, read) {
            try {
                const response = await fetch('/api/emails/mark-read', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: emailId, read: read })
                });
                
                if (response.status === 401) {
                    logout();
                    return;
                }
                
                const result = await response.json();
                
                if (result.success) {
                    loadEmails(currentFolder);
                } else {
                    alert('操作失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 移动邮件提示
        function moveEmailPrompt(emailId) {
            let folderOptions = '';
            folders.forEach(folder => {
                if (folder.id != currentFolder) {
                    folderOptions += \`<option value="\${folder.id}">\${folder.name}</option>\`;
                }
            });
            
            const targetFolderId = prompt(\`请选择目标文件夹:\\n\${folderOptions}\`);
            if (targetFolderId) {
                moveEmail(emailId, parseInt(targetFolderId));
            }
        }
        
        // 移动邮件
        async function moveEmail(emailId, folderId) {
            try {
                const response = await fetch('/api/emails/move', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: emailId, folderId: folderId })
                });
                
                if (response.status === 401) {
                    logout();
                    return;
                }
                
                const result = await response.json();
                
                if (result.success) {
                    loadEmails(currentFolder);
                } else {
                    alert('移动失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 删除邮件
        async function deleteEmail(emailId, permanent = false) {
            if (!confirm(permanent ? '确定要永久删除这封邮件吗？此操作不可撤销。' : '确定要删除这封邮件吗？')) return;
            
            try {
                const response = await fetch('/api/emails/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: emailId, permanent: permanent })
                });
                
                if (response.status === 401) {
                    logout();
                    return;
                }
                
                const result = await response.json();
                
                if (result.success) {
                    alert(result.message);
                    loadEmails(currentFolder);
                } else {
                    alert('删除失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('删除请求失败: ' + error.message);
            }
        }
        
        // 发送邮件
        async function sendEmail() {
            const to = document.getElementById('to').value;
            const subject = document.getElementById('subject').value;
            const body = document.getElementById('body').value;
            const fromUser = document.getElementById('fromUser').value || 'sak';
            const messageDiv = document.getElementById('send-message');
            
            if (!to || !subject || !body) {
                messageDiv.textContent = '请填写完整的收件人、主题和内容';
                messageDiv.className = 'message error';
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
                    messageDiv.className = 'message success';
                    clearForm();
                    setTimeout(() => {
                        messageDiv.textContent = '';
                    }, 3000);
                } else {
                    messageDiv.textContent = '发送失败: ' + (result.message || '未知错误');
                    messageDiv.className = 'message error';
                }
            } catch (error) {
                messageDiv.textContent = '发送请求失败: ' + error.message;
                messageDiv.className = 'message error';
            }
        }
        
        // 清空表单
        function clearForm() {
            document.getElementById('to').value = '';
            document.getElementById('subject').value = '';
            document.getElementById('body').value = '';
        }
        
        // 创建文件夹
        async function createFolder() {
            const name = document.getElementById('new-folder-name').value;
            
            if (!name) {
                alert('请输入文件夹名称');
                return;
            }
            
            try {
                const response = await fetch('/api/folders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ name })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('文件夹创建成功');
                    document.getElementById('new-folder-name').value = '';
                    await loadFolders();
                } else {
                    alert('创建失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 删除文件夹
        async function deleteFolder(folderId) {
            if (!confirm('确定要删除这个文件夹吗？文件夹中的邮件将被移动到收件箱。')) return;
            
            try {
                const response = await fetch('/api/folders/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: folderId })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('文件夹已删除');
                    await loadFolders();
                } else {
                    alert('删除失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 加载拦截规则
        async function loadRules() {
            try {
                const response = await fetch('/api/rules');
                const result = await response.json();
                
                if (result.success) {
                    rules = result.rules;
                    renderRules();
                } else {
                    console.error('加载规则失败:', result.message);
                }
            } catch (error) {
                console.error('加载规则请求失败:', error);
            }
        }
        
        // 渲染拦截规则
        function renderRules() {
            const rulesList = document.getElementById('rules-list');
            rulesList.innerHTML = '<h3>现有规则</h3>';
            
            if (rules.length === 0) {
                rulesList.innerHTML += '<p>暂无拦截规则</p>';
                return;
            }
            
            rules.forEach(rule => {
                const ruleElement = document.createElement('div');
                ruleElement.className = 'rule-item';
                ruleElement.innerHTML = \`
                    <div><strong>\${rule.name}</strong> (\${rule.type}: "\${rule.value}")</div>
                    <div>操作: \${rule.action === 'move' ? '移动到文件夹' : '直接删除'}\${rule.action === 'move' && rule.target_folder_id ? ' (ID: ' + rule.target_folder_id + ')' : ''}</div>
                    <div>状态: \${rule.is_active ? '启用' : '禁用'}</div>
                    <button onclick="deleteRule(\${rule.id})" class="small danger">删除</button>
                \`;
                rulesList.appendChild(ruleElement);
            });
        }
        
        // 加载目标文件夹选项
        function loadTargetFolderOptions() {
            const targetFolderSelect = document.getElementById('rule-target-folder');
            targetFolderSelect.innerHTML = '';
            
            folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = folder.name;
                targetFolderSelect.appendChild(option);
            });
        }
        
        // 创建拦截规则
        async function createRule() {
            const name = document.getElementById('rule-name').value;
            const type = document.getElementById('rule-type').value;
            const value = document.getElementById('rule-value').value;
            const action = document.getElementById('rule-action').value;
            const targetFolderId = document.getElementById('rule-target-folder').value;
            
            if (!name || !value) {
                alert('请填写规则名称和规则值');
                return;
            }
            
            if (action === 'move' && !targetFolderId) {
                alert('请选择目标文件夹');
                return;
            }
            
            try {
                const response = await fetch('/api/rules', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        name, 
                        type, 
                        value, 
                        action, 
                        target_folder_id: action === 'move' ? targetFolderId : null 
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('规则创建成功');
                    // 清空表单
                    document.getElementById('rule-name').value = '';
                    document.getElementById('rule-value').value = '';
                    await loadRules();
                } else {
                    alert('创建失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 删除拦截规则
        async function deleteRule(ruleId) {
            if (!confirm('确定要删除这个拦截规则吗？')) return;
            
            try {
                const response = await fetch('/api/rules/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: ruleId })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('规则已删除');
                    await loadRules();
                } else {
                    alert('删除失败: ' + (result.message || '未知错误'));
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 重置数据库
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
        
        // HTML转义函数
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
    // 检查是否已初始化
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='folders'"
    ).first();
    
    if (tables) {
      return; // 数据库已初始化
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
        is_deleted BOOLEAN DEFAULT 0,
        has_attachments BOOLEAN DEFAULT 0,
        folder_id INTEGER DEFAULT 1,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_id) REFERENCES folders (id)
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
        size INTEGER,
        FOREIGN KEY (email_id) REFERENCES emails (id)
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (target_folder_id) REFERENCES folders (id)
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

// 存储附件
async function storeAttachment(emailId, attachment, env) {
  try {
    const content = await attachment.arrayBuffer();
    
    await env.DB.prepare(
      "INSERT INTO attachments (email_id, filename, content_type, content, size) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      emailId,
      attachment.filename,
      attachment.contentType,
      new Uint8Array(content),
      content.byteLength
    ).run();
    
    console.log(`附件已存储: ${attachment.filename}`);
  } catch (error) {
    console.error("存储附件错误:", error);
  }
}