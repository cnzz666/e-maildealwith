// 综合邮件处理Worker - 修复版 + 玻璃效果界面
export default {
  // 处理接收到的邮件
  async email(message, env, ctx) {
    try {
      const from = message.from;
      const to = message.to;
      const subject = message.headers.get("subject") || "无主题";
      const text = await message.text();
      const html = await message.html();
      
      console.log(`收到邮件: ${from} -> ${to}, 主题: ${subject}`);
      
      // 将邮件信息存入D1数据库
      const result = await env.DB.prepare(
        "INSERT INTO emails (sender, recipient, subject, body, html_body, received_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(from, to, subject, text, html, new Date().toISOString()).run();
      
      console.log(`邮件已存储，ID: ${result.meta.last_row_id}`);
    } catch (error) {
      console.error("处理邮件时出错:", error);
    }
  },

  // 处理HTTP请求
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 处理登录
    if (path === "/login" && request.method === "POST") {
      return await this.handleLogin(request, env);
    }
    
    // 获取邮件列表API
    if (path === "/api/emails" && request.method === "GET") {
      return await this.getEmails(request, env);
    }
    
    // 发送邮件API
    if (path === "/api/send" && request.method === "POST") {
      return await this.sendEmail(request, env);
    }
    
    // 默认返回管理界面
    return this.getAdminInterface(request, env);
  },

  // 处理登录
  async handleLogin(request, env) {
    try {
      const { username, password } = await request.json();
      
      // 硬编码的用户名和密码
      const ADMIN_USERNAME = "admin";
      const ADMIN_PASSWORD = "1591156135qwzxcv";
      
      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: "登录成功" 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
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

  // 获取邮件列表
  async getEmails(request, env) {
    try {
      console.log("开始查询邮件列表...");
      
      // 测试数据库连接
      const testResult = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log("数据库表:", testResult);
      
      const result = await env.DB.prepare(
        "SELECT id, sender, recipient, subject, body, received_at FROM emails ORDER BY received_at DESC LIMIT 100"
      ).all();
      
      console.log("查询结果:", result);
      
      if (!result.success) {
        throw new Error("数据库查询失败");
      }
      
      return new Response(JSON.stringify({
        success: true,
        emails: result.results || []
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (error) {
      console.error("获取邮件列表错误:", error);
      return new Response(JSON.stringify({ 
        success: false, 
        message: "获取邮件列表失败: " + error.message 
      }), { 
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  },

  // 发送邮件
  async sendEmail(request, env) {
    try {
      const { to, subject, text, fromUser = 'sak' } = await request.json();
      
      // 构建发件人地址
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
        return new Response(JSON.stringify({ 
          success: true, 
          message: "邮件发送成功",
          id: result.id 
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "发送失败: " + (result.message || "未知错误") 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: "发送请求失败: " + error.message 
      }), { 
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  },

  // 返回管理界面
  getAdminInterface(request, env) {
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>邮件管理系统</title>
    <style>
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
        .content {
            text-align: center;
            max-width: 95%;
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
        input, textarea, button {
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
        input, textarea {
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
        input:focus, textarea:focus {
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
        .email-list {
            max-height: 400px;
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
        }
        .email-sender {
            font-weight: bold;
            color: #0277bd;
        }
        .email-subject {
            font-weight: bold;
            margin: 5px 0;
        }
        .email-preview {
            color: #666;
            font-size: 0.9em;
            margin: 5px 0;
        }
        .email-date {
            color: #999;
            font-size: 0.8em;
            text-align: right;
        }
        .section {
            margin: 25px 0;
            padding: 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 10px;
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
        .form-group {
            margin: 15px 0;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #0277bd;
        }
        @media (max-width: 768px) {
            .content {
                max-width: 90%;
                padding: 20px;
            }
            h1 {
                font-size: 1.8rem;
            }
            input, textarea, button {
                width: 90%;
                font-size: 14px;
                padding: 10px;
            }
        }
        #login-section, #admin-interface {
            width: 100%;
        }
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <!-- 登录页面 -->
    <div id="login-section" class="content">
        <h1>邮件管理系统</h1>
        <div class="section">
            <h2>管理员登录</h2>
            <input type="text" id="username" placeholder="用户名" value="admin">
            <input type="password" id="password" placeholder="密码" value="1591156135qwzxcv">
            <button onclick="login()">登录</button>
            <div id="login-message" class="message"></div>
        </div>
    </div>

    <!-- 管理主界面 -->
    <div id="admin-interface" class="content hidden">
        <h1>邮件管理系统</h1>
        
        <!-- 邮件列表区域 -->
        <div class="section">
            <h2>收到的邮件</h2>
            <button onclick="loadEmails()">刷新邮件列表</button>
            <div id="mail-list" class="email-list">
                <div class="message">加载中...</div>
            </div>
        </div>

        <!-- 发送邮件区域 -->
        <div class="section">
            <h2>发送邮件</h2>
            <div class="form-group">
                <label for="fromUser">发件人别名:</label>
                <input type="text" id="fromUser" placeholder="sak" value="sak">
                <small>将作为发件人地址的用户名部分，如: sak@ilqx.dpdns.org</small>
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

        <button onclick="logout()" style="background: linear-gradient(45deg, #f44336, #e57373);">退出登录</button>
    </div>

    <script>
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
                        loadEmails();
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
        function logout() {
            document.getElementById('admin-interface').classList.add('hidden');
            document.getElementById('login-section').classList.remove('hidden');
            document.getElementById('password').value = '1591156135qwzxcv';
            document.getElementById('login-message').textContent = '';
        }

        // 加载邮件列表
        async function loadEmails() {
            const mailList = document.getElementById('mail-list');
            
            try {
                const response = await fetch('/api/emails');
                const result = await response.json();
                
                if (result.success) {
                    if (result.emails.length === 0) {
                        mailList.innerHTML = '<div class="message">收件箱为空</div>';
                        return;
                    }
                    
                    mailList.innerHTML = result.emails.map(email => \`
                        <div class="email-item">
                            <div class="email-sender">发件人: \${escapeHtml(email.sender)}</div>
                            <div class="email-subject">主题: \${escapeHtml(email.subject)}</div>
                            <div class="email-preview">\${escapeHtml(email.body ? email.body.substring(0, 100) : '无内容')}\${email.body && email.body.length > 100 ? '...' : ''}</div>
                            <div class="email-date">\${new Date(email.received_at).toLocaleString()}</div>
                        </div>
                    \`).join('');
                } else {
                    mailList.innerHTML = \`<div class="message error">加载失败: \${result.message || '未知错误'}</div>\`;
                }
            } catch (error) {
                mailList.innerHTML = \`<div class="message error">请求失败: \${error.message}</div>\`;
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
            // 不清空发件人别名
        }

        // HTML转义函数，防止XSS
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 页面加载动画
        document.addEventListener('DOMContentLoaded', function() {
            var contents = document.querySelectorAll('.content');
            setTimeout(function() {
                contents.forEach(content => {
                    content.classList.add('loaded');
                });
            }, 100);
            
            // 自动填充测试数据（可选）
            document.getElementById('to').value = 'test@example.com';
            document.getElementById('subject').value = '测试邮件';
            document.getElementById('body').value = '这是一封测试邮件内容。';
        });
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}