#!/usr/bin/env node
require('babel-polyfill')

const chalk = require('chalk')
const exec = require('child_process').exec
const GitHubApi = require('github')
const logSymbols = require('log-symbols')

const github = new GitHubApi({
  // required
  version: '3.0.0',
  // optional
  headers: {
    'user-agent': 'github-ci-status'
  }
})

// Get the current SHAsum.
function get_sha () {
  return new Promise(function (resolve, reject) {
    exec('git rev-parse HEAD', (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

// Get the GitHub repo details for the checked out path.
function get_user_repo () {
  return new Promise(function (resolve, reject) {
    exec('git config --get remote.origin.url', (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }
      const url = stdout.trim()
      const parts = url.split('/')
      // GitHub URLs can have many forms, taking the last two path parameters
      // is the only robust way to discover the user/repo.
      let user = parts[parts.length - 2].replace('.git', '')
      const repo = parts[parts.length - 1].replace('.git', '')
      if (user.includes(':')) {
        // SSH-style git@github.com:foo
        user = user.split(':')[1]
      }
      resolve({user, repo})
    })
  })
}

// Get the CI status for the given commit
function check_status (user, repo, sha) {
  return new Promise(function (resolve, reject) {
    console.log(`Checking ${user}/${repo}:${sha.substring(0, 10)}\n`)
    github.statuses.getCombined({user, repo, sha}, (err, status) => {
      if (err) {
        reject(err)
      } else {
        resolve(status)
      }
    })
  })
}

function print_each_status (statuses) {
  const state_to_logsymbol = {
    'success': 'success',
    'pending': 'warning',
    'error': 'warning',
    'failure': 'error'
  }

  statuses.forEach(status => {
    if (status.state in state_to_logsymbol) {
      const symbol = state_to_logsymbol[status.state]
      console.log(logSymbols[symbol], status.description)
    } else {
      console.error(`Unknown status received from github: ${status.state}`)
      process.exit(1)
    }
  })
}

async function start () {
  let status
  try {
    const sha = await get_sha()
    const {user, repo} = await get_user_repo()
    status = await check_status(user, repo, sha)
  } catch (err) {
    console.error(logSymbols.warning, err.toString())
    process.exit(1)
  }

  /* Exit codes:
   *
   * 0: all tests passed
   * 1: error getting status
   * 2: some tests failed
   * 3: some tests are pending
   * 4: the required number of tests weren't run
   */
  print_each_status(status.statuses)
  switch (status.state) {
    case 'error':
      console.error(logSymbols.warning, chalk.yellow('CI tests errored'))
      process.exit(1)
      break
    case 'failure':
      console.error(logSymbols.error, chalk.red('CI tests failed'))
      process.exit(2)
      break
    case 'pending':
      console.error(logSymbols.warning, chalk.yellow('CI still pending'))
      process.exit(3)
      break
    case 'success':
      if (status.statuses.length < 3) {
        console.error(logSymbols.warning, chalk.yellow(
          `The required number of tests weren't run (${status.statuses.length} vs 3)`
        ))
        process.exit(4)
      }
      console.log(logSymbols.success, chalk.green('CI tests passed'))
      process.exit(0)
    default:
      console.error(`Unknown status received from github: ${status.state}`)
      process.exit(1)
  }
}

start()
