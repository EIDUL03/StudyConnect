const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 });

const PORT = process.env.PORT || 3000;
const MAX = 50;
const GRACE = 30 * 60 * 1000;
const rooms = new Map();

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const token = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const name = n =>
  (String(n || 'Student').trim() || 'Student').slice(0, 30);

function code() {
  let c;
  do {
    c = String(Math.floor(10000 + Math.random() * 90000));
  } while (rooms.has(c));
  return c;
}

function userView(u) {
  return {
    token: u.token,
    name: u.name,
    host: u.host,
    connected: !!u.socketId,
    socketId: u.socketId || null,
    permissions: { ...u.permissions },
    locks: { ...u.locks }
  };
}

function find(r, t) {
  return r && [...r.users.values()].find(u => u.token === t);
}

function host(s, r) {
  const u = find(r, s.data.token);
  return !!u && u.token === r.hostToken && u.socketId === s.id;
}

function emitUsers(r) {
  io.to(r.code).emit('participants', {
    users: [...r.users.values()].map(userView),
    hostToken: r.hostToken
  });
}

function delayedDelete(r) {
  clearTimeout(r.timer);

  r.timer = setTimeout(() => {
    if (![...r.users.values()].some(u => u.socketId)) {
      rooms.delete(r.code);
    }
  }, GRACE);
}

function remove(r, u) {
  r.users.delete(u.token);

  if (r.hostToken === u.token) {
    const n = [...r.users.values()].find(x => x.socketId);

    if (n) {
      n.host = true;
      r.hostToken = n.token;

      io.to(n.socketId).emit('host-status', {
        host: true
      });
    } else {
      r.hostToken = null;
    }
  }

  emitUsers(r);

  if (!r.users.size) {
    rooms.delete(r.code);
  }
}

function permission(r, u) {
  if (u.socketId) {
    io.to(u.socketId).emit('permissions-updated', {
      permissions: u.permissions,
      locks: u.locks
    });
  }

  emitUsers(r);
}

io.on('connection', s => {

  s.on('create-room', ({ name: n, token: t } = {}, cb) => {

    const rt = String(t || token());

    const u = {
      token: rt,
      socketId: s.id,
      name: name(n),
      host: true,

      permissions: {
        audio: true,
        video: true,
        whiteboardWriter: true,
        upload: true,
        screen: true
      },

      locks: {
        audio: false,
        video: false
      }
    };

    const r = {
      code: code(),
      hostToken: rt,
      users: new Map([[rt, u]]),
      timer: null
    };

    rooms.set(r.code, r);

    s.join(r.code);
    s.data.room = r.code;
    s.data.token = rt;

    cb?.({
      ok: true,
      code: r.code,
      token: rt,
      host: true,
      users: [userView(u)]
    });

    emitUsers(r);
  });

  s.on('join-room', ({ code: c, name: n, token: t } = {}, cb) => {

    c = String(c || '').trim();

    const r = rooms.get(c);

    if (!r) {
      return cb?.({
        ok: false,
        error: 'Room not found.'
      });
    }

    let u = t && find(r, String(t));

    if (u) {
      u.socketId = s.id;
      u.name = name(n || u.name);
    } else {

      if (r.users.size >= MAX) {
        return cb?.({
          ok: false,
          error: 'Classroom is full (50 students maximum).'
        });
      }

      u = {
        token: token(),
        socketId: s.id,
        name: name(n),
        host: false,

        permissions: {
          audio: true,
          video: true,
          whiteboardWriter: false,
          upload: false,
          screen: false
        },

        locks: {
          audio: false,
          video: false
        }
      };

      r.users.set(u.token, u);
    }

    clearTimeout(r.timer);

    s.join(c);
    s.data.room = c;
    s.data.token = u.token;

    cb?.({
      ok: true,
      token: u.token,
      host: u.host,
      users: [...r.users.values()].map(userView)
    });

    emitUsers(r);
  });

  s.on('leave-room', () => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);

    if (r && u) {
      remove(r, u);
    }

    s.leave(s.data.room || '');

    s.data.room = null;
    s.data.token = null;
  });

  s.on('signal', ({ to, data } = {}) => {
    if (to) {
      io.to(to).emit('signal', {
        from: s.id,
        data
      });
    }
  });

  s.on('chat', ({ text } = {}) => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);
    const t = String(text || '').trim();

    if (!r || !u || !t) return;

    io.to(r.code).emit('chat', {
      name: u.name,
      text: t.slice(0, 1000),
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })
    });
  });

  s.on('host-permission', ({ token: t, type, allowed } = {}) => {

    const r = rooms.get(s.data.room);

    if (!r || !host(s, r)) return;

    const u = find(r, t);

    if (!u || u.token === r.hostToken) return;

    if (type === 'audio' || type === 'video') {

      u.locks[type] = !allowed;
      u.permissions[type] = !!allowed;

    } else if (
      ['upload', 'screen', 'whiteboardWriter'].includes(type)
    ) {

      if (type === 'whiteboardWriter' && allowed) {
        [...r.users.values()].forEach(x => {
          x.permissions.whiteboardWriter = false;
        });
      }

      u.permissions[type] = !!allowed;
    }

    permission(r, u);
    emitUsers(r);
  });

  s.on('whiteboard', d => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);

    if (
      r &&
      u &&
      (u.permissions.whiteboardWriter || host(s, r))
    ) {
      s.to(r.code).emit('whiteboard', d);
    }
  });

  s.on('whiteboard-clear', () => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);

    if (
      r &&
      u &&
      (u.permissions.whiteboardWriter || host(s, r))
    ) {
      s.to(r.code).emit('whiteboard-clear');
    }
  });

  s.on('upload-material', p => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);

    if (
      !r ||
      !u ||
      (!u.permissions.upload && !host(s, r)) ||
      !p?.data ||
      String(p.data).length > 6e6
    ) {
      return;
    }

    io.to(r.code).emit('material', {
      name: String(p.name || 'Study material').slice(0, 120),
      type: String(
        p.type || 'application/octet-stream'
      ).slice(0, 100),
      data: p.data,
      by: u.name
    });
  });

  s.on('screen-state', ({ sharing } = {}) => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);

    if (
      r &&
      u &&
      (u.permissions.screen || host(s, r))
    ) {
      io.to(r.code).emit('screen-state', {
        token: u.token,
        sharing: !!sharing,
        name: u.name
      });
    }
  });

  s.on('disconnect', () => {

    const r = rooms.get(s.data.room);
    const u = find(r, s.data.token);

    if (!r || !u) return;

    if (u.socketId === s.id) {
      u.socketId = null;
    }

    emitUsers(r);
    delayedDelete(r);
  });
});


/* =========================
   EID AI
   ========================= */

app.get('/api/health', (q, res) => {
  res.json({
    ok: true,
    rooms: rooms.size
  });
});

app.post('/api/ai', async (q, res) => {

  const key = process.env.OPENAI_API_KEY;

  const question = String(
    q.body?.question || ''
  ).trim().slice(0, 4000);

  if (!key) {
    return res.status(503).json({
      error: 'Eid AI is not configured yet.'
    });
  }

  if (!question) {
    return res.status(400).json({
      error: 'Ask Eid AI a question.'
    });
  }

  try {

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },

        body: JSON.stringify({
          model: 'gpt-5.6-luna',

          instructions:
            'You are Eid AI, a concise study assistant inside StudyConnect. Explain academic topics clearly and step by step when useful.',

          input: question,

          max_output_tokens: 1000
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        'Eid AI OpenAI error:',
        JSON.stringify(data)
      );

      return res.status(500).json({
        error:
          data?.error?.message ||
          'Eid AI request failed.'
      });
    }

    /*
      The Responses API returns the generated text
      inside the output array.

      We extract every output_text section safely.
    */

    let answer = '';

    if (Array.isArray(data.output)) {

      for (const item of data.output) {

        if (!Array.isArray(item.content)) {
          continue;
        }

        for (const content of item.content) {

          if (
            content.type === 'output_text' &&
            typeof content.text === 'string'
          ) {
            answer += content.text;
          }
        }
      }
    }

    answer = answer.trim();

    console.log(
      'Eid AI answer received:',
      answer ? 'YES' : 'NO'
    );

    if (!answer) {
      console.error(
        'Eid AI response contained no text:',
        JSON.stringify(data)
      );

      return res.status(500).json({
        error: 'Eid AI returned no text.'
      });
    }

    res.json({
      answer
    });

  } catch (e) {

    console.error(
      'Eid AI server error:',
      e
    );

    res.status(500).json({
      error: 'Eid AI is temporarily unavailable.'
    });
  }
});


server.listen(PORT, () => {
  console.log(
    `StudyConnect running on port ${PORT}`
  );
});