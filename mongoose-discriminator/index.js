
const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/test');

const baseOptions = {
  discriminatorKey : "type",
  	collection       : "campaign",
};

const baseCampaignSchema = new mongoose.Schema(
  {
    customer_id         : { type: String },
    campaign_name       : { type: String },
    campaign_start_date : { type: Date },
    campaign_end_date   : { type: Date },
  },
  baseOptions,
);

const BaseCampaign = mongoose.model('Campaign', baseCampaignSchema);

const SMSCampaign = BaseCampaign.discriminator('SMSCampaign', new mongoose.Schema({
  text : { type: String, required: true }
})
);

const NotifCampaign = BaseCampaign.discriminator('NotifCampaign', new mongoose.Schema({
  title : { type: String, required: true },
  body  : { type: String, required: true }
})
);

const EmailCampaign = BaseCampaign.discriminator('EmailCampaign', new mongoose.Schema({
  subject    : { type: String, required: true },
  plain_text : { type: String, required: true },
  html_text  : { type: String, required: true }
})
);

const init = async () => {
  try {
    console.log('start of the script');
    const sms = new SMSCampaign({
      customer_id         : 'CMP_100',
      campaign_name       : 'SMS 100',
      campaign_start_date : new Date(1677497579000),
      campaign_end_date   : new Date(1679916779000),
      text           					: 'This is a sms campaign'
    });

    const appNotif = new NotifCampaign({
      customer_id         : 'CMP_101',
      campaign_name       : 'Notif 101',
      campaign_start_date : new Date(1677497579000),
      campaign_end_date   : new Date(1679916779000),
      title          					: 'This is app notif title',
      body           					: 'This is app notif body',
    });

    const email = new EmailCampaign({
      customer_id         : 'CMP_102',
      campaign_name       : 'Email 102',
      campaign_start_date : new Date(1677497579000),
      campaign_end_date   : new Date(1679916779000),
      subject         				: 'This is email campaign',
      plain_text       			: 'This is email body in plain text',
      html_text       				: '<p>This is email body in html text</p>',
    });

    await Promise.all([sms.save(), appNotif.save(), email.save()]);
    const count = await BaseCampaign.countDocuments();
    console.log('Total:', count);
  } catch (err) {
    console.log('error:', err.message);
  }
}

init();
