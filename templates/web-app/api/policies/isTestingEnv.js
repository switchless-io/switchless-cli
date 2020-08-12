module.exports = function(req, res, next) {
	if (process.env.NODE_ENV=='test'||process.env.NODE_ENV=='development') {
		return next();
	}
	else{		
		res.send('this endpoint can only accessed in testing environment');
	}
};
