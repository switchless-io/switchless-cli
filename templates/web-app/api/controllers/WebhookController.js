module.exports = {
    razorpay: function (req, res) {
        var signature = req.headers["x-razorpay-signature"];
        var secret = sails.config.razorpay.webhook_secret;
        var is_valid = RazorpayService.validateWebhookSignature(JSON.stringify(req.body), signature, secret);
        if (!is_valid)
            return res.status(403).json({ error: 'unauthorized' });

        async.auto({
            getUser: function (cb) {
                var pg_customer_id = _.get(req.body, `payload[${req.body.contains[0]}].entity.customer_id`)
                RazorpayService.instance.customers.fetch(pg_customer_id, function (err, customer) {
                    if (err) return cb(err);
                    User.findOne({ email: customer.email }).exec(cb);
                })
            },
            createPgEvent: ['getUser', function (results, cb) {
                Pg_event.create({
                    pg: 'razorpay',
                    event_type: _.get(req.body, 'event', 'unknow'),
                    log: req.body,
                    user: results.getUser.id
                }).fetch().exec(cb);
            }],
            processWebhook: ['createPgEvent', function (results, cb) {
                switch (req.body.event) {
                    case "invoice.paid":
                        RazorpayService.processInvoicePaidEvent(results.createPgEvent, cb);
                        break;
                    case "subscription.activated":
                        RazorpayService.processSubscriptionActivatedEvent(results.createPgEvent, cb);
                        break;
                    case "subscription.charged":
                        RazorpayService.processSubscriptionChargedEvent(results.createPgEvent, cb);
                        break;
                    case "subscription.cancelled":
                        RazorpayService.processSubscriptionCancelledEvent(results.createPgEvent, cb);
                        break;
                    case "subscription.halted":
                        RazorpayService.processSubscriptionHaltedEvent(results.createPgEvent, cb);
                        break;
                    case "subscription.pending":
                        break;
                    case "subscription.updated":
                        break;
                    default:
                        cb(null);
                        break;
                }
            }]
        }, function (err, results) {
            if (err)
                console.log(err)
            return res.ok();
        });
    },
    mailgunInboundParser: function(req, res){
        console.log('\n\n======');
        console.log(typeof req.body);

        if (req.query.secret!='thomtharikidathomthithitharikidathom')
            return res.status(403).json({ error: 'unauthorized' });

        async.auto({
            createActivity:function(callback){
                var activity ={
                    type:'received_email',
                    doer_type:'system',
                    log:{
                        email:req.body,
                    },
                    // gstin:results.identifyGSTIN.id
                };
                Activity.create(activity).fetch().exec(callback)
            },
            identifyGSTIN:function(callback){
                var value = req.body.recipient.split('@')[0].toUpperCase();
                GSTIN.findOne({value:value}).exec(function(err,gstin){
                    if(err)
                        return callback(err);
                    if(!gstin)
                        return callback("No GSTIN found");


                    // checking if sender is allowed.
                    allowed_senders=_.get(gstin.details,"settings.allowed_senders");

                    // if no one is set in allowed senders then anyone can send email
                    if(!allowed_senders || allowed_senders.length==0) 
                        return callback(null,gstin);
                    var allow = false;
                    allowed_senders.forEach(function(email){
                        if(email==req.body.sender)
                            allow=true;
                    });
                    if(allow)
                        return callback(null,gstin);
                    else 
                        return callback('This sender is not allowed');
                });
                // callback(null,)
            },
            // isSenderAllowed:['identifyGSTIN',function(callback){
                
            // }],
            updateActivity:['identifyGSTIN','createActivity',function(results,callback){
                var activity ={
                    gstin:results.identifyGSTIN.id
                };
                Activity.updateOne({id:results.createActivity.id},activity).exec(callback)
            }],
        },function(err,results){
            if(err=='This sender is not allowed'|| err=='No GSTIN found')
                return res.send(err);
            else if(err)
                throw err;
            res.send('ok');
        })  
    }
}