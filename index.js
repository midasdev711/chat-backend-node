var express = require('express');
var cors = require('cors')
var bodyParser = require('body-parser');
var app = express();
const dotenv = require('dotenv');
dotenv.config();

app.use(cors())
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var expressWs = require('express-ws')(app);
const { v4: uuidv4 } = require('uuid');
const { Client } = require('pg');

const db = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

var connections = {}
db.connect();

async function queryDB(query) {
  return await new Promise((resolve, reject) => {
    db.query(query, (err, res) => {
      if (err) {
        console.error(err);
        reject(err);
        return;
      }
      // db.end();
      resolve(res);
      return res;
    });
  })
}

async function saveMessage(msg) {
  let created_at = new Date().toISOString()
  if (msg.room_id) {
    var query = `
      INSERT INTO chat_message (sender, receiver, text, message_type, room_id, created_at) VALUES ('${msg.sender}', '${msg.receiver}', '${msg.message}', '${msg.message_type}', '${msg.room_id}', '${created_at}')
    `;
  } else {
    var query = `
      INSERT INTO chat_message (sender, receiver, text, message_type, created_at) VALUES ('${msg.sender}', '${msg.receiver}', '${msg.message}', '${msg.message_type}', '${created_at}')
    `;
  }
  return await queryDB(query);
}

async function loadMessages(payload) {
  if (payload.room_id) {
    var query = `
      SELECT chat_message.id, chat_message.text, chat_message.created_at, chat_message.message_type, chat_message.sender, users.username FROM chat_message INNER JOIN users ON (cast(chat_message.sender as uuid) = users.user_id) WHERE chat_message.room_id = '${payload.room_id}' ORDER BY chat_message.created_at DESC;
    `;
  } else {
    var query = `
      SELECT chat_message.id, chat_message.text, chat_message.created_at, chat_message.message_type, chat_message.sender, users.username FROM chat_message INNER JOIN users ON (cast(chat_message.sender as uuid) = users.user_id) WHERE (chat_message.sender = '${payload.user1}' AND chat_message.receiver = '${payload.user2}') OR (chat_message.sender = '${payload.user2}' AND chat_message.receiver = '${payload.user1}') ORDER BY chat_message.created_at DESC;
    `;
  }
  let res = await queryDB(query);
  return res;
}

app.post('/api/getMessages', async function(req, res) {
  let messages = await loadMessages(req.body)
  let result = messages.rows.slice((req.body.page - 1) * req.body.offset, req.body.page * req.body.offset);
  res.json({messages: result, count: messages.rowCount})
});

var aWss = expressWs.getWss('/ws/chat/:room_id');

app.ws('/ws/chat/:room_id', function(ws, req) {
  var room_id = req.params.room_id;
  let id = uuidv4();
  if (!connections[room_id]) {
    connections[room_id] = {}
  }
  connections[room_id][id] = ws;
  ws.on('message', function(msg) {
    console.log(Object.keys(connections[room_id]))
    for (let key in connections[room_id]) {
      let newMsg = JSON.parse(msg);
      newMsg['type'] = newMsg.message_type
      connections[room_id][key].send(JSON.stringify(newMsg));
      saveMessage(newMsg);
    }
  });

  ws.on('close', function clear() {
    delete connections[room_id][id]
  });
});

app.listen(8000);