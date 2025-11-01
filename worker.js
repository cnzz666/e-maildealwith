// 综合邮件处理Worker - 同时处理邮件接收、Web界面和发送功能
export default {
  // 处理接收到的邮件 (Email Worker功能)
  async email(message, env, ctx) {
    try {
      const from = message.from;
      const to = message.to;
      const subject = message.headers.get("subject") || "无主题";
      const text = await message.text();
      const html = await message.html();
      
      // 将邮件信息存入D1数据库
      await env.DB.prepare(
        "INSERT INTO emails (sender, recipient, subject, body, html_body, received_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(from, to, subject, text, html, new Date().toISOString()).run();
      
      console.log(`邮件已存储: ${from} -> ${to}`);
    } catch (error) {
      console.error("处理邮件时出错:", error);
    }
  },

  // 处理HTTP请求 (Web界面和API)
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
      
      // 验证用户名和密码
      if (username === "admin" && password === "1591156135qW") {
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
      const { success, results } = await env.DB.prepare(
        "SELECT id, sender, subject, body, received_at FROM emails ORDER BY received_at DESC LIMIT 100"
      ).all();
      
      if (!success) {
        throw new Error("数据库查询失败");
      }
      
      return new Response(JSON.stringify({
        success: true,
        emails: results || []
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (error) {
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
      const { to, subject, text } = await request.json();
      
      // 使用Resend发送邮件（免费方案）
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'your-verified-domain@yourdomain.com', // 需在Resend验证的域名
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>邮件管理系统</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 20px; text-align: center; }
        
        /* 登录页面样式 */
        #login-section { max-width: 400px; margin: 50px auto; padding: 20px; }
        .login-form { background: #f9f9f9; padding: 20px; border-radius: 8px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"], input[type="password"], input[type="email"], textarea { 
            width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; 
        }
        button { 
            background: #007cba; color: white; border: none; padding: 10px 15px; 
            border-radius: 4px; cursor: pointer; margin-right: 10px; 
        }
        button:hover { background: #005a87; }
        
        /* 主界面样式 */
        #admin-interface { display: none; }
        .section { margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
        .section h2 { color: #444; margin-bottom: 15px; }
        
        /* 邮件列表样式 */
        .email-list { max-height: 500px; overflow-y: auto; border: 1px solid #ddd; }
        .email-item { 
            padding: 15px; border-bottom: 1px solid #eee; cursor: pointer; 
            transition: background 0.2s;
        }
        .email-item:hover { background: #f9f9f9; }
        .email-item:last-child { border-bottom: none; }
        .email-sender { font-weight: bold; color: #007cba; }
        .email-subject { font-weight: bold; margin: 5px 0; }
        .email-preview { color: #666; font-size: 0.9em; }
        .email-date { color: #999; font-size: 0.8em; text-align: right; }
        
        /* 撰写邮件样式 */
        #compose-form { background: #f9f9f9; padding: 15px; border-radius: 8px; }
        .form-actions { margin-top: 15px; text-align: right; }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            .container { padding: 10px; }
            .email-list { max-height: 300px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>邮件管理系统</h1>
        
        <!-- 登录区域 -->
        <div id="login-section">
            <div class="login-form">
                <h2>管理员登录</h2>
                <div class="form-group">
                    <label for="username">用户名:</label>
                    <input type="text" id="username" placeholder="请输入用户名" value="admin">
                </div>
                <div class="form-group">
                    <label for="password">密码:</label>
                    <input type="password" id="password" placeholder="请输入密码" value="1591156135qW">
                </div>
                <button onclick="login()">登录</button>
                <div id="login-message" style="margin-top: 15px; color: red;"></div>
            </div>
        </div>
        
        <!-- 管理主界面 -->
        <div id="admin-interface">
            <!-- 邮件列表区域 -->
            <div class="section">
                <h2>收到的邮件</h2>
                <button onclick="loadEmails()">刷新邮件列表</button>
                <div id="mail-list" class="email-list">
                    <div style="padding: 20px; text-align: center;">加载中...</div>
                </div>
            </div>
            
            <!-- 撰写邮件区域 -->
            <div class="section">
                <h2>发送邮件</h2>
                <div id="compose-form">
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
                        <textarea id="body" rows="6" placeholder="邮件内容"></textarea>
                    </div>
                    <div class="form-actions">
                        <button onclick="sendEmail()">发送邮件</button>
                        <button onclick="clearForm()">清空</button>
                    </div>
                    <div id="send-message" style="margin-top: 15px;"></div>
                </div>
            </div>
        </div>
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
                    document.getElementById('login-section').style.display = 'none';
                    document.getElementById('admin-interface').style.display = 'block';
                    loadEmails();
                } else {
                    messageDiv.textContent = result.message || '登录失败';
                }
            } catch (error) {
                messageDiv.textContent = '登录请求失败: ' + error.message;
            }
        }
        
        // 加载邮件列表
        async function loadEmails() {
            const mailList = document.getElementById('mail-list');
            
            try {
                const response = await fetch('/api/emails');
                const result = await response.json();
                
                if (result.success) {
                    if (result.emails.length === 0) {
                        mailList.innerHTML = '<div style="padding: 20px; text-align: center;">暂无邮件</div>';
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
                    mailList.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">加载失败: ' + (result.message || '未知错误') + '</div>';
                }
            } catch (error) {
                mailList.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">请求失败: ' + error.message + '</div>';
            }
        }
        
        // 发送邮件
        async function sendEmail() {
            const to = document.getElementById('to').value;
            const subject = document.getElementById('subject').value;
            const body = document.getElementById('body').value;
            const messageDiv = document.getElementById('send-message');
            
            if (!to || !subject || !body) {
                messageDiv.innerHTML = '<span style="color: red;">请填写完整的收件人、主题和内容</span>';
                return;
            }
            
            try {
                const response = await fetch('/api/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ to, subject, text: body })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    messageDiv.innerHTML = '<span style="color: green;">邮件发送成功!</span>';
                    clearForm();
                } else {
                    messageDiv.innerHTML = '<span style="color: red;">发送失败: ' + (result.message || '未知错误') + '</span>';
                }
            } catch (error) {
                messageDiv.innerHTML = '<span style="color: red;">发送请求失败: ' + error.message + '</span>';
            }
        }
        
        // 清空表单
        function clearForm() {
            document.getElementById('to').value = '';
            document.getElementById('subject').value = '';
            document.getElementById('body').value = '';
        }
        
        // HTML转义函数，防止XSS
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // 页面加载完成后尝试自动登录（仅用于测试，生产环境应移除）
        // document.addEventListener('DOMContentLoaded', function() {
        // // 自动登录仅用于演示，生产环境应移除
        // if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // login();
        // }
        // });
    </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}