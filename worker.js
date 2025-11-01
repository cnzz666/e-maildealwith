// 完整的邮件管理系统 - 玻璃效果界面 + 邮件查看回复功能
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
      
      // 检查拦截规则
      const shouldBlock = await checkBlockRules(from, subject, text, env);
      if (shouldBlock) {
        console.log(`🚫 邮件被拦截: ${from} -> ${to}`);
        await saveEmailToDatabase(env, from, to, subject, text, html, 3, 1);
        return;
      }
      
      // 存储邮件到数据库 - 收件箱
      await saveEmailToDatabase(env, from, to, subject, text, html, 1, 0);
      
      console.log('✅ 邮件处理完成');
      
    } catch (error) {
      console.error('❌ 处理邮件时出错:', error);
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
      'GET:/api/email': () => this.getEmailDetail(request, env),
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

  // 获取邮件详情
  async getEmailDetail(request, env) {
    try {
      const url = new URL(request.url);
      const emailId = url.searchParams.get('id');
      
      if (!emailId) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "邮件ID不能为空" 
        }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 获取邮件详情
      const email = await env.DB.prepare(
        `SELECT e.*, f.name as folder_name 
         FROM emails e 
         LEFT JOIN folders f ON e.folder_id = f.id 
         WHERE e.id = ?`
      ).bind(emailId).first();
      
      if (!email) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "邮件不存在" 
        }), { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 标记为已读
      await env.DB.prepare("UPDATE emails SET is_read = 1 WHERE id = ?").bind(emailId).run();
      
      return new Response(JSON.stringify({
        success: true,
        email: email
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error("获取邮件详情错误:", error);
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取邮件详情失败: " + error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // 调试信息
  async getDebugInfo(request, env) {
    try {
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all();
      
      const emailCount = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM emails"
      ).first();
      
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
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>邮件管理系统</title>
    <style>
        /* 玻璃效果样式 */
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
            padding: 30px;
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
        
        /* 标题样式 */
        h1 {
            font-size: 2.5rem;
            margin-bottom: 20px;
            color: #0277bd;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        h2 {
            color: #0277bd;
            margin-bottom: 15px;
            text-shadow: 0 0 5px rgba(79, 195, 247, 0.3);
        }
        
        /* 输入框和按钮样式 */
        input, textarea, select, button {
            margin: 15px auto;
            padding: 12px 20px;
            font-size: 16px;
            border-radius: 25px;
            outline: none;
            display: block;
            width: 80%;
            max-width: 400px;
            transition: all 0.3s ease;
        }
        input, textarea, select {
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
        button {
            background: linear-gradient(45deg, #4fc3f7, #81d4fa);
            border: none;
            color: #333333;
            cursor: pointer;
            font-weight: bold;
            text-transform: uppercase;
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
        button.warning {
            background: linear-gradient(45deg, #ff9800, #ffb74d);
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
            cursor: pointer;
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
        
        /* 邮件详情样式 */
        .email-detail {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
        }
        .email-header {
            border-bottom: 1px solid rgba(79, 195, 247, 0.3);
            padding-bottom: 15px;
            margin-bottom: 15px;
        }
        .email-content {
            line-height: 1.6;
            white-space: pre-wrap;
        }
        .email-html-content {
            background: rgba(255, 255, 255, 0.5);
            padding: 15px;
            border-radius: 5px;
            margin-top: 15px;
            max-height: 400px;
            overflow-y: auto;
        }
        
        /* 统计信息样式 */
        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .stat-card {
            flex: 1;
            min-width: 150px;
            padding: 15px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            text-align: center;
            border: 1px solid rgba(79, 195, 247, 0.3);
        }
        
        /* 弹窗样式 */
        .modal {
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
        }
        .modal-content {
            background: rgba(255, 255, 255, 0.9);
            padding: 20px;
            border-radius: 15px;
            max-width: 90%;
            max-height: 80%;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 10px;
        }
        .close-modal {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }
        
        /* 状态按钮 */
        .status-btn {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(255, 255, 255, 0.3);
            border: 1px solid rgba(79, 195, 247, 0.5);
            border-radius: 50%;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 100;
            backdrop-filter: blur(5px);
            transition: all 0.3s ease;
        }
        .status-btn:hover {
            background: rgba(79, 195, 247, 0.3);
            transform: scale(1.1);
        }
        
        /* 其他样式 */
        .hidden {
            display: none !important;
        }
        .section {
            margin: 20px 0;
            padding: 20px;
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
        
        /* 移动端优化 */
        @media (max-width: 768px) {
            .content {
                max-width: 95%;
                padding: 20px;
            }
            h1 {
                font-size: 2rem;
            }
            input, textarea, select, button {
                width: 90%;
                font-size: 14px;
                padding: 10px;
            }
            .stats {
                flex-direction: column;
            }
            .stat-card {
                min-width: auto;
            }
            .sender-input {
                width: 40% !important;
            }
        }
    </style>
</head>
<body>
    <!-- 状态检查按钮 -->
    <div class="status-btn" onclick="showSystemStatus()">
        <span style="font-size: 24px;">⚙️</span>
    </div>

    <!-- 系统状态弹窗 -->
    <div id="system-status-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>系统状态</h2>
                <button class="close-modal" onclick="closeModal('system-status-modal')">&times;</button>
            </div>
            <div id="system-status-content">
                <p>加载中...</p>
            </div>
        </div>
    </div>

    <!-- 邮件详情弹窗 -->
    <div id="email-detail-modal" class="modal">
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h2>邮件详情</h2>
                <button class="close-modal" onclick="closeModal('email-detail-modal')">&times;</button>
            </div>
            <div id="email-detail-content">
                <p>加载中...</p>
            </div>
        </div>
    </div>

    <!-- 登录页面 -->
    <div id="login-section" class="content ${isLoggedIn ? 'hidden' : ''}">
        <h1>邮件管理系统</h1>
        <div class="section">
            <h2>管理员登录</h2>
            <input type="text" id="username" placeholder="用户名" value="admin">
            <input type="password" id="password" placeholder="密码" value="1591156135qwzxcv">
            <button onclick="login()">登录</button>
            <div id="login-message" class="message"></div>
            
            ${!dbStatus.initialized ? '<div class="message warning"><p>数据库未初始化</p><button onclick="resetDatabase()" class="small">初始化数据库</button></div>' : ''}
        </div>
    </div>

    <!-- 管理主界面 -->
    <div id="admin-interface" class="content ${isLoggedIn ? '' : 'hidden'}">
        <h1>邮件管理系统</h1>
        
        <!-- 统计信息 -->
        <div class="stats">
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
        <div id="tab-inbox" class="tab-content">
            <div class="section">
                <h2>收件箱</h2>
                <button onclick="loadEmails(1)">刷新邮件列表</button>
                <div id="inbox-list" class="email-list">
                    <div class="message">加载中...</div>
                </div>
            </div>
        </div>

        <!-- 垃圾邮件 -->
        <div id="tab-spam" class="tab-content hidden">
            <div class="section">
                <h2>垃圾邮件</h2>
                <button onclick="loadEmails(3)">刷新垃圾邮件</button>
                <div id="spam-list" class="email-list">
                    <div class="message">加载中...</div>
                </div>
            </div>
        </div>

        <!-- 发送邮件 -->
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

        <!-- 设置 -->
        <div id="tab-settings" class="tab-content hidden">
            <div class="section">
                <h2>系统设置</h2>
                <button onclick="resetDatabase()" class="danger">重置数据库</button>
                <p><small>警告: 这将删除所有邮件、文件夹和规则</small></p>
                <button onclick="logout()">退出登录</button>
            </div>
        </div>
    </div>

    <script>
        let currentFolder = 1;
        let currentEmailId = null;
        
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
            await loadStats();
            await loadEmails(1);
        }
        
        // 显示系统状态
        async function showSystemStatus() {
            const modal = document.getElementById('system-status-modal');
            const content = document.getElementById('system-status-content');
            
            try {
                const response = await fetch('/api/debug');
                const result = await response.json();
                
                if (result.success) {
                    content.innerHTML = \`
                        <div class="email-detail">
                            <h3>数据库状态</h3>
                            <p><strong>数据库表:</strong> \${JSON.stringify(result.debug.tables.map(t => t.name))}</p>
                            <p><strong>邮件总数:</strong> \${result.debug.emailCount}</p>
                            <p><strong>文件夹:</strong> \${JSON.stringify(result.debug.folders.map(f => f.name))}</p>
                            <p><strong>更新时间:</strong> \${new Date(result.debug.timestamp).toLocaleString()}</p>
                        </div>
                        <button onclick="resetDatabase()" class="danger small">重置数据库</button>
                    \`;
                } else {
                    content.innerHTML = '<p class="error">获取系统状态失败: ' + result.message + '</p>';
                }
            } catch (error) {
                content.innerHTML = '<p class="error">请求失败: ' + error.message + '</p>';
            }
            
            modal.style.display = 'flex';
        }
        
        // 关闭弹窗
        function closeModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
        }
        
        // 显示邮件详情
        async function showEmailDetail(emailId) {
            const modal = document.getElementById('email-detail-modal');
            const content = document.getElementById('email-detail-content');
            currentEmailId = emailId;
            
            try {
                const response = await fetch('/api/email?id=' + emailId);
                const result = await response.json();
                
                if (result.success) {
                    const email = result.email;
                    let contentHtml = '';
                    
                    if (email.html_body) {
                        contentHtml = \`
                            <div class="email-detail">
                                <div class="email-header">
                                    <p><strong>发件人:</strong> \${escapeHtml(email.sender)}</p>
                                    <p><strong>收件人:</strong> \${escapeHtml(email.recipient)}</p>
                                    <p><strong>主题:</strong> \${escapeHtml(email.subject)}</p>
                                    <p><strong>时间:</strong> \${new Date(email.received_at).toLocaleString()}</p>
                                </div>
                                <div class="email-html-content">
                                    \${email.html_body}
                                </div>
                            </div>
                        \`;
                    } else {
                        contentHtml = \`
                            <div class="email-detail">
                                <div class="email-header">
                                    <p><strong>发件人:</strong> \${escapeHtml(email.sender)}</p>
                                    <p><strong>收件人:</strong> \${escapeHtml(email.recipient)}</p>
                                    <p><strong>主题:</strong> \${escapeHtml(email.subject)}</p>
                                    <p><strong>时间:</strong> \${new Date(email.received_at).toLocaleString()}</p>
                                </div>
                                <div class="email-content">
                                    \${escapeHtml(email.body || '无内容')}
                                </div>
                            </div>
                        \`;
                    }
                    
                    contentHtml += \`
                        <div class="email-actions">
                            <button onclick="replyToEmail('\${escapeHtml(email.sender)}', '\${escapeHtml(email.subject)}')" class="success">回复</button>
                            <button onclick="markEmailRead(\${email.id}, \${email.is_read ? 'false' : 'true'})">
                                \${email.is_read ? '标记未读' : '标记已读'}
                            </button>
                            \${currentFolder === 3 ? 
                                '<button onclick="markEmailSpam(' + email.id + ', false)" class="success">不是垃圾邮件</button>' : 
                                '<button onclick="markEmailSpam(' + email.id + ', true)" class="warning">标记垃圾邮件</button>'
                            }
                            <button onclick="deleteEmail(\${email.id})" class="danger">删除</button>
                        </div>
                    \`;
                    
                    content.innerHTML = contentHtml;
                } else {
                    content.innerHTML = '<p class="error">获取邮件详情失败: ' + result.message + '</p>';
                }
            } catch (error) {
                content.innerHTML = '<p class="error">请求失败: ' + error.message + '</p>';
            }
            
            modal.style.display = 'flex';
        }
        
        // 回复邮件
        function replyToEmail(sender, subject) {
            closeModal('email-detail-modal');
            showTab('send');
            
            // 预填回复信息
            document.getElementById('to').value = sender;
            document.getElementById('subject').value = 'Re: ' + subject;
            document.getElementById('body').value = '\\n\\n--- 原始邮件 ---\\n';
            
            // 滚动到发送区域
            document.getElementById('tab-send').scrollIntoView({ behavior: 'smooth' });
        }
        
        // 加载统计信息
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
        
        // 加载邮件列表
        async function loadEmails(folderId) {
            currentFolder = folderId;
            const listId = folderId === 3 ? 'spam-list' : 'inbox-list';
            const listElement = document.getElementById(listId);
            listElement.innerHTML = '<div class="message">加载中...</div>';

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
                } else {
                    listElement.innerHTML = '<div class="message error">加载失败: ' + result.message + '</div>';
                }
            } catch (error) {
                listElement.innerHTML = '<div class="message error">请求失败: ' + error.message + '</div>';
            }
        }
        
        // 渲染邮件列表
        function renderEmails(emails, listId, folderId) {
            const listElement = document.getElementById(listId);
            
            if (emails.length === 0) {
                listElement.innerHTML = '<div class="message">该文件夹为空</div>';
                return;
            }

            let emailsHTML = '';
            emails.forEach(email => {
                const emailClass = folderId === 3 ? 'email-item spam' : 
                                 email.is_read ? 'email-item' : 'email-item unread';
                emailsHTML += \`
                    <div class="\${emailClass}" onclick="showEmailDetail(\${email.id})">
                        <div class="email-sender"><strong>发件人:</strong> \${escapeHtml(email.sender)}</div>
                        <div class="email-subject"><strong>主题:</strong> \${escapeHtml(email.subject)}</div>
                        <div class="email-preview">\${escapeHtml(email.body ? email.body.substring(0, 100) : '无内容')}\${email.body && email.body.length > 100 ? '...' : ''}</div>
                        <div class="email-date">\${new Date(email.received_at).toLocaleString()}</div>
                        <div class="email-actions">
                            <button onclick="event.stopPropagation(); markEmailRead(\${email.id}, \${email.is_read ? 'false' : 'true'})" class="small">
                                \${email.is_read ? '标记未读' : '标记已读'}
                            </button>
                            \${folderId === 3 ? 
                                '<button onclick="event.stopPropagation(); markEmailSpam(' + email.id + ', false)" class="small success">不是垃圾邮件</button>' : 
                                '<button onclick="event.stopPropagation(); markEmailSpam(' + email.id + ', true)" class="small warning">标记垃圾邮件</button>'
                            }
                            <button onclick="event.stopPropagation(); deleteEmail(\${email.id})" class="small danger">删除</button>
                        </div>
                    </div>
                \`;
            });
            
            listElement.innerHTML = emailsHTML;
        }
        
        // 标记垃圾邮件
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
                    closeModal('email-detail-modal');
                } else {
                    alert('操作失败: ' + result.message);
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 标记已读/未读
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
                    if (document.getElementById('email-detail-modal').style.display === 'flex') {
                        showEmailDetail(emailId); // 刷新详情
                    }
                } else {
                    alert('操作失败: ' + result.message);
                }
            } catch (error) {
                alert('请求失败: ' + error.message);
            }
        }
        
        // 删除邮件
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
                    closeModal('email-detail-modal');
                } else {
                    alert('删除失败: ' + result.message);
                }
            } catch (error) {
                alert('删除请求失败: ' + error.message);
            }
        }
        
        // 显示标签页
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.remove('hidden');
            event.target.classList.add('active');
            
            if (tabName === 'inbox') loadEmails(1);
            if (tabName === 'spam') loadEmails(3);
        }
        
        // 登录
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