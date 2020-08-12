var path = require('path');
var fs = require('fs');
var cpx = require('cpx');


var sails_folder = process.cwd();

var package_folder = path.join(process.cwd(),'node_modules/@switchless-io/cli');
module.exports={
	initialiseAPIBackend:function(callback){

		if (fs.existsSync(sails_folder+'/api/controllers/AuthController.js'))
		    console.log('AuthController already exists. It will be over written.');

		cpx.copySync(package_folder+'/templates/web-app/controllers/*', sails_folder+'/api/controllers');
		cpx.copySync(package_folder+'/templates/web-app/models/*', sails_folder+'/api/models');
		cpx.copySync(package_folder+'/templates/web-app/services/**', sails_folder+'/api/services');
		cpx.copySync(package_folder+'/templates/web-app/policies/**', sails_folder+'/api/policies');
		cpx.copySync(package_folder+'/templates/web-app/views/**', sails_folder+'/views');

		if(fs.existsSync(sails_folder+'/api/controllers/AuthController.js') && fs.existsSync(sails_folder+'/views/login.ejs')){
			var buf = fs.readFileSync(package_folder+'/templates/web-app/text/post_install.txt');
			console.log(buf.toString());

		}else{
			console.log('kue installation failed');
		}
		// console.log('installed user login');
		callback(null);
	},
	initialiseWebApp:function(callback){
		// install jquery dependency
		console.log('came here');
		// cpx.copySync(package_folder+'/templates/web-app/**/{*,.*}', sails_folder);
		// cpx.copySync(package_folder+'/templates/web-app/.**/{*,.*}', sails_folder);
		cpx.copySync(package_folder+'/templates/web-app/{**,.**}/{*,.*}', sails_folder);
		// cpx.copySync(package_folder+'/templates/web-app/{*,.*}', sails_folder);
		// console.log(package_folder);
		// console.log(sails_folder);
		// copyfiles([package_folder+'/templates/web-app/**', sails_folder],'-a',function(err){
		// copyfiles(['/Users/alex/ec2code/asyncauto/test_app/node_modules/@switchless-io/cli/templates/web-app/**', '/Users/alex/ec2code/asyncauto/test_app'],'-a -E',function(err){
			// console.log(err);
			console.log("\--------------------------------------------------------------------------------\
				\n hello\
				\n Web app template applied \
			");
			return callback(null);
		// });
		// cpx.copySync(package_folder+'/templates/web-app/controllers/*', sails_folder+'/api/controllers');
		// cpx.copySync(package_folder+'/templates/web-app/models/*', sails_folder+'/api/models');
		// cpx.copySync(package_folder+'/templates/web-app/services/**', sails_folder+'/api/services');
		// cpx.copySync(package_folder+'/templates/web-app/policies/**', sails_folder+'/api/policies');
		// cpx.copySync(package_folder+'/templates/web-app/views/**', sails_folder+'/views');
		// cpx.copySync(package_folder+'/assets/jquery/**', sails_folder+'/assets/dependencies/');
		// cpx.copySync(package_folder+'/assets/semantic/**', sails_folder+'/assets/dependencies/sematic');
		
		// callback(null);
	},
}