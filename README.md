# BlueRobot Action Processor Microservice

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Project Status](#project-status)
- [Contributing to the project](#contributing-to-the-project)
- [Overview](#overview)
- [Integration testing](#integration-testing)
  - [_Prerequisites_](#prerequisites)
- [Getting Started](#getting-started)
- [Code Style and Linting](#code-style-and-linting)
- [NPM Tasks](#npm-tasks)
  - [Setting NPM_TOKEN used by docker-compose](#setting-npm_token-used-by-docker-compose)
- [Running tests with docker](#running-tests-with-docker)
- [Environment Variables (.env)](#environment-variables-env)
  - [Config-Maps & Secrets](#config-maps--secrets)
  - [MySQL DB Change management](#mysql-db-change-management)
    - [Environment Variables](#environment-variables)
- [CI / CD Processes](#ci--cd-processes)

---

- [Technical Specification](https://addynamo.atlassian.net/wiki/display/BR/Action+Processor)

## Project Status

This section provides a status overview of the main branch of this project.

![Build and Test](https://github.com/addynamo/action-processor/workflows/Build%20and%20Test/badge.svg)

## Contributing to the project

_**Very important!**_

Before contributing code to the project please familiarize yourself with [the code standards guideline document](https://goo.gl/exBGNz) in order to understand what is expected of you when making a contribution.

## Overview

This project serves to provide a start from which BlueRobot microservices can be created.

The project provides a simple node application with

- [Koa](http://koajs.com/) for middleware,
- [Winston](https://github.com/winstonjs/winston) for logging,
- [npm](http://npmjs.com/) as task runner,
- [Mocha](https://mochajs.org/) for testing (and [Chai](http://chaijs.com/) for assertions),
- [nyc](https://github.com/istanbuljs/nyc) for code coverage reporting,
- [Github Actions](https://docs.github.com/en/free-pro-team@latest/actions/) for continues integration (CI) and continuous deployment (CD),
- and is packaged as [Docker](https://www.docker.com/) images,
- and deployed to [Kubernetes](http://kubernetes.io/).

## Integration testing

### _Prerequisites_

- _You will need to have `docker` and `docker-compose` installed._
- _You must also set up environment variables required for the application to communicate with GNIP and amqp. Consult the .env.example to see examples of all the required env variables, and fill in any that are not in the docker-compose.yml_

For live/integration testing, a Dockerfile and docker-compose.yml have been provided.
The following commands can be used to fire up the microservice with instances of mysql and amqp:

- `docker-compose up` - will start the microservice with all its dependencies and the ports mapped as specified in docker-compose.yml; the ports exposed are used to either interact with the microservice or to access the management consoles for its dependencies.
- `docker-compose up -d` - will start the containers in the background.
- `docker-compose up --build` - will rebuild and start the containers.
- `docker-compose down` - will shut down the containers.

## Getting Started

The following steps will help you get your new microservice project set up:

1. Clone the project to a local folder
1. Run `npm install` to download the requisite node packages
1. Run `npm start` to start the application (as in production), or `npm run develop` to run the application during development

And that's pretty much it!

## Code Style and Linting

To ensure that code style and practices are kept consistent, this project includes

- [EditorConfig](http://editorconfig.org/) to override editor specific formatting (see '.editorconfig' file). Plugins for popular IDE's are available.
- [ESLint](http://eslint.org/) for linting of JavaScript. We extend the popular [Airbnb ESLint config](https://www.npmjs.com/package/eslint-config-airbnb), and we override some specific rules (see '.eslintrc' file).

## NPM Tasks

Some NPM tasks are included to simplify the workflow:

- `npm start` - Will run the application with the `node app/app.js` command. **Note that this task is also used by Docker to start your application.**
- `npm test` - Will launch Mocha to run all tests in the './test' folder
- `npm run test:watch` - Will launch Mocha to watch all tests in the './test' folder, rerunning them when you change any tests or code.
- `npm run coverage` - Will create a coverage report using nyc (formerly Istanbul), and throw an error if the coverage is less than 90% for statements, branches, functions or lines.
- `npm run develop` - Launch the application with 'nodemon', app will restart when any js file in 'app' is modified.
- `npm run lint` - Lints the JavaScript files in 'app' and 'test'.
- `npm run clean` - cleans up temporary files.

### Setting NPM_TOKEN used by docker-compose

Docker compose requires your a NPM token to access private npm modules and should be set to `NPM_TOKEN`.

To do that for your local session you can execute:

```bash
export NPM_TOKEN="token"
```

or add it to your `~/.bashrc` (or `~/.zshrc`) for a more permanent solution.

## Running tests with docker

_You should have Wercker CLI installed before running these commands._

```bash
$ wercker build
```

## Environment Variables (.env)

Environment variables (accessed through `process.env`) are managed by [dotenv](https://www.npmjs.com/package/dotenv).

**Please do not commit environment variables to source control.** This is a significant security risk.

It is fine to make use of the '.env' file for local testing, but please do not check this file into source control. An example is included (see '.env.example').

For production the environment variables are mounted by Kubernetes within the '.env' file.

### Config-Maps & Secrets

Environment variables in k8s services are configured through kubernetes [secrets](https://kubernetes.io/docs/concepts/configuration/secret/) and [config maps](https://kubernetes.io/docs/concepts/configuration/configmap/). Secrets are used for sensitive data and config maps for non-sensitive data.

For examples on how to create config-maps & secrets for this service, [see the microservice-boilerplate](https://github.com/addynamo/microservice-boilerplate#config-maps--secrets)

### MySQL DB Change management

To make a DB change, submit a PR containing a new, versioned change-script to the [`bluerobot-database`](https://github.com/addynamo/bluerobot-database)
project (the single source of truth for all our DB structures). Please refer to the script naming convention and follow any other instructions in the `README.md`.

Locally, when starting up your project, the database is created and updated by the `flyway-db-migration` service in docker-compose.yml.
Please ensure you specify your access details in the `docker-compose.override.yml` to ensure your local DB is kept up to date. When you
run `docker-compose up` the `flyway-db-migration` pulls the latest `master` branch from [`bluerobot-database`](https://github.com/addynamo/bluerobot-database)
and migrates your database to match.

To reset your local database, simply `docker-compose down` and `rm -rf ./mysql` and start your service up again.

#### Environment Variables

**NB!**: To correctly authorise with the repository containing the DB schema, you can specify either:

- `GIT_SSH_KEY` OR
- both `GIT_USERNAME` AND `GIT_TOKEN`

You can add the following to your `~/.bash_profile` or `~/.zshrc` to make sure the `GIT_SSH_KEY` is always present:
```bash
export GIT_SSH_KEY="$(base64 -i ~/.ssh/id_rsa)"
```

List of Env Vars:

- `GIT_SSH_KEY`: The ssh key used to access the database git repository
- `GIT_USERNAME`: Your git username (works with github username)
- `GIT_TOKEN`: Your git token or password (works with github personal access token)
- `GIT_PROJECT`: Usually always addynamo/bluerobot-database (unless your schema comes from a different github repository)
- `GIT_SCHEMA_FOLDER`: The folder inside the above repository containing the relevant schema (Usually always `bluerobot`)

## CI / CD Processes

GitHub [Github Actions](https://docs.github.com/en/free-pro-team@latest/actions) ensures our code builds and passes tests, coverage and linting. It also pushes docker images to the Google Container Registry, and is responsible for deploying to staging and production.

- Code is built and checked for passing tests, coverage and linting when:
  - A Pull Request is created (including draft PRs).
  - Code is pushed to an open Pull Request
- When the Pull Request is Merged:
  - The code is tagged with the version shown in `package.json`
  - A docker image is built and pushed to the Google Container Registry
  - The newly-created docker image is deployed to staging
- Code will be deployed to production when a release is created in GitHub.
  - Find the tag in [github.com](https://github.com/addynamo)
  - Click the 3 dots next to the tag you want to deploy
  - Completing the release form to create a release.

Things to note:

1. Please see [Config-Maps & Secrets](#config-maps-&-secrets) for information about how to include environment variables in your deployments
2. GitHub action workflows that push, & deploy to staging & production can be re-run on github under the repository's actions tab.
