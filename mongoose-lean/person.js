const mongoose = require('mongoose');
const v8 = require('v8');

mongoose.connect('mongodb://127.0.0.1:27017/test');

const groupSchema = new mongoose.Schema({
  _id  : { type: String },
  name : { type: String }
});

groupSchema.virtual('members', {
  ref          : 'Person',
  localField   : '_id',
  foreignField : 'groupId'
});

const Group = mongoose.model('Group', groupSchema);

function capitalizeFirstLetter(v) {
  return v.charAt(0).toUpperCase() + v.substring(1);
}

const personSchema = new mongoose.Schema({
  _id       : { type: String },
  firstName : {
    type : String,
    get  : capitalizeFirstLetter
  },
  lastName : {
    type : String,
    get  : capitalizeFirstLetter
  },
  groupId : { type: String, ref: 'Group' }
});

personSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

const Person = mongoose.model('Person', personSchema);

const init = async () => {

  console.log('start of the script');
  const group = await Group.create({ _id: 'G100', name: 'Group 100' });
  await Person.create([
    { _id: 'P100', firstName: 'manish', lastName: 'prasad', groupId: group._id },
    { _id: 'P101', firstName: 'ravi', lastName: 'das', groupId: group._id },
  ]);

  const normalDoc = await Person.findOne();
  const leanDoc = await Person.findOne().lean();

  console.log(normalDoc instanceof mongoose.Document); // true
  console.log(normalDoc.constructor.name); // 'model'

  console.log(leanDoc instanceof mongoose.Document); // false
  console.log(leanDoc.constructor.name); // 'Object'

  console.log(v8.serialize(normalDoc).length);
  console.log(v8.serialize(leanDoc).length);

  console.log(normalDoc.fullName); // 'Manish Prasad'
  console.log(normalDoc.firstName); // 'Manish', because of `capitalizeFirstLetter()`
  console.log(normalDoc.lastName); // 'Prasad', because of `capitalizeFirstLetter()`

  console.log(leanDoc.fullName); // undefined, virtual doesn't run
  console.log(leanDoc.firstName); // 'manish', custom getter doesn't run
  console.log(leanDoc.lastName); // 'prasad', custom getter doesn't run

  const groupRecord = await Group.findOne().lean().populate({
    path    : 'members',
    options : { sort: { name: 1 } }
  });
  console.log(groupRecord.members[0].firstName); // 'manish'
  console.log(groupRecord.members[1].firstName); // 'ravi'

  // Both the `group` and the populated `members` are lean.
  console.log(groupRecord instanceof mongoose.Document); // false
  console.log(groupRecord.members[0] instanceof mongoose.Document); // false
  console.log(groupRecord.members[1] instanceof mongoose.Document); // false


}

init();
