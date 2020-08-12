/**
 * BullBootstrap.js
 * Bootstrap module that setups the queue and worker
 */
const async = require('async');

var Bull = require('bull');
// create our job queue
var queue = new Bull('queue', { redis: sails.config.bull.redis });
sails.config.queue = queue;


module.exports = function (callback) {

	queue.process('send_transactional_email',1,function(job,done){
		TransactionalEmailService.sendTransactionalEmail(job.data.options,function(err,result){
			done(err,result);
		})
	});
	// var folder_name = __dirname;
	// folder_name = folder_name.split('/bootstraps')[0];
	// queue.process('crawl_gstr3b',1,folder_name+'/api/processors/crawlGSTR3B.js');
	// queue.process('crawl_gstr2a',1,folder_name+'/api/processors/crawlGSTR2A.js');
	// queue.process('crawl_gstr1',1,folder_name+'/api/processors/crawlGSTR1.js');
	queue.process('add_portal_data_to_tracker',1,function(job,done){
		if(job.data.options.what=='gstr3b'){
			CrawlService.addGSTR3B(job.data.options,function(err,result){
				done(err,result);
			})
		}else if(job.data.options.what=='gstr2a'){
			CrawlService.addGSTR2A(job.data.options,function(err,result){
				done(err,result);
			})
		}else if(job.data.options.what=='gstr1'){
			CrawlService.addGSTR1(job.data.options,function(err,result){
				done(err,result);
			})
		}
	});


	/**
	 * crons
	 */

	// Repeat check for hung charging sessions  once every hour
	_.forEach(sails.config.bull.repeats, function (task) {
		if (task.active) {
			queue.add(task.name, task.data, { repeat: task.repeat });
			sails.log.info(`bull repeatable job registered: ${task.name}`);
		}
	});


	queue.process('clean_completed_jobs', 1, function(job,done){
		BullService.deleteBullTasks(1000, 'completed')
		done();
	});
	
	queue.process('clean_failed_jobs', 1, function(job,done){
		BullService.deleteBullTasks(1000, 'failed')
		done();
	});

	callback(null);
};
