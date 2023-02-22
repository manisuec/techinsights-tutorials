const mongoose = require('mongoose');
const crypto = require('crypto');

mongoose.connect('mongodb://127.0.0.1:27017/test');

const getSHAHash = async str =>
  Promise.resolve(crypto.createHash('sha256').update(str).digest('hex'));

const userSchema = new mongoose.Schema({
  _id      : { type: String },
  name     : { type: String },
  username : { type: String },
  password : { type: String }
});


userSchema.pre('save', async function() {
  console.log('pre hook: validate username');
  const user = this;
  const regex = /^[a-zA-Z0-9]+$/;
  const result = regex.test(user.username);

  if (result) {
    console.log('username validated');

    return Promise.resolve();
  } else {
    console.log('this will stop execution of next middlewares');
    throw new Error('username is not alphanumeric');
  }
});

userSchema.pre('save', async function() {
  console.log('pre hook: generate password hash');
  const user = this;

  const passHash = await getSHAHash(user.password);
  console.log('password hash generated');
  user.password = passHash;
});


userSchema.post('save', async function() {
  console.log('post hook called');
  console.log('notify/send email');
  const user = this;
});

const User = mongoose.model('User', userSchema);

userSchema.pre('save', async () => {
  console.log('pre hook: after calling mongoose.model()');
  console.log('this pre hook will not be called');
});

const init = async () => {
  try {
    console.log('start of the script');
    await User.create({ _id: Date.now(), name: 'Manish', username: 'manisuec', password: 'abc123' });
    console.log('first user created successfully');
    console.log('-------------------------------------------');
    await User.create({ _id: Date.now(), name: 'Ravi', username: 'ravi@123', password: 'abc123' });
  } catch (err) {
    console.log('error:', err.message);
  }
}

init();
