## switchless-cli

Switchless is an opinionated tech stack. We have already choosen a language(javascript), a web framework(sailsjs),database(postgres, elastic search for logs),libraries(trix,semantic ui.. etc) and 3rd party tools(cloudflare, aws, beanstalk, metabase, sentry etc) all put together for your convinience. 

This tech stack is more than good enough for 80% of the scenarios that you will encounter as a web developer. You will be able to spend more time building and less time searching. 

### Our opinion 
1. Developers spend too much time premature optimising their stack. Most of the time you dont need react for your simple project
2. [Software is entering the deployment age](http://reactionwheel.net/2015/10/the-deployment-age.html). You can expect less disruptive changes compared to the previous decade.
3. This means, it pays to stick to one stack and master that inside out, instead of constantly searching for the latest and greatest. Switchless for maximising your productivity.
4. This does not mean never keep yourself updated. Of course, Keep yourself updated - but in a more calm and collected manner. 


### Usage

```sh
# start using inside any sails project
cd my_sails_project

# Install locally
npm install --save-dev @switchless-io/cli@latest

# run the command
./node_modules/@switchless-io/cli/index.js
```

### Supports
- [x] Queue setup via Bull.js
- [x] Setup for server logging via AWS Kinesis
- [x] Rate-limiting middleware
- [x] Scaffolding for Fomantic UI
- [x] Scaffolding for Trix Editor
- [x] Scaffolding for User Login
- [x] Setup Error tracking via Sentry
- [x] Scaffolding for Group Access Control
- [ ] Web Security(coming soon)
- [ ] Scaffolding for Vue(coming soon)
