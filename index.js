const core = require('@actions/core')
const {Octokit} = require("@octokit/rest")
const {retry} = require("@octokit/plugin-retry");
const {throttling} = require("@octokit/plugin-throttling");
const util = require("util");

const body = core.getInput('BODY', {required: true}).trim()
const org = core.getInput('ORG', {required: true, trimWhitespace: true}).trim()
const teamName = core.getInput('TEAM', {required: true, trimWhitespace: true}).trim()
const repo = core.getInput('REPO', {required: true, trimWhitespace: true}).trim()
const suffix = core.getInput('SUFFIX', {required: true, trimWhitespace: true}).trim()
const issueNumber = Number(core.getInput('ISSUE_NUMBER', {required: true, trimWhitespace: true}).trim())
const token = core.getInput('TOKEN', {required: true, trimWhitespace: true}).trim()
const successMessage = core.getInput('SUCCESS_MESSAGE', {required: true, trimWhitespace: true}).trim()

const template = core.getInput('TEMPLATE', {required: true, trimWhitespace: true}).trim()

const _Octokit = Octokit.plugin(retry, throttling)
const client = new _Octokit({
    auth: token,
    throttle: {
        onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
            if (options.request.retryCount === 0) {
                octokit.log.info(`Retrying after ${retryAfter} seconds!`);
                return true;
            }
        },
        onAbuseLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`);
        },
    }

})

async function main() {
    const filteredBody = body.substr(1, body.length - 2).replace(/\r\n/g, "\\n"); // Trim quotes off end and replace carriage returns
    const name = filteredBody.match(new RegExp('Full Name.+###'))[0].split('\\n\\n')[1].trim()
    const email = filteredBody.match(new RegExp('Email.+###'))[0].split('\\n\\n')[1].trim()
    const pm = filteredBody.match(new RegExp('PM/COR Email.+###'))[0].split('\\n\\n')[1].trim()
    const pmUsername = filteredBody.match(new RegExp('PM/COR GitHub Username.+###'))[0].split('\\n\\n')[1].trim()
    const contract = filteredBody.match(new RegExp('Assigned Contract.+'))[0].split('\\n\\n')[1].trim()

    let username = filteredBody.match(new RegExp('GitHub Username.+###'))[0].split('\\n\\n')[1].trim()
    if (username.includes('@')) {
        username = username.substr(1)
    }

    let user
    let team
    try {
        core.info(`Fetching user information for ${username}`)
        user = await client.users.getByUsername({
            username: username
        })
    } catch (e) {
        fail(`Failed fetching user information: ${e}`)
    }

    try {
        core.info(`Retrieving team information`)
        team = await client.teams.getByName({
            org: org,
            team_slug: teamName
        })
    } catch (e) {
        fail(`Failed fetching team information: ${e}`)
    }
    if (email.includes(suffix)) {
        try {
            core.info('Creating invitation')
            await client.orgs.createInvitation({
                org: org,
                invitee_id: user.data.id,
                role: 'direct_member',
                team_ids: [team.data.id]
            })
        } catch (e) {
            fail(`Failed creating invitation: ${e}`)
        }
        try {
            core.info('Creating success comment')
            await client.issues.createComment({
                issue_number: issueNumber,
                owner: org,
                repo: repo,
                body: successMessage
            })
            core.info('Closing issue as it requires no approval')
            await client.issues.update({
                issue_number: issueNumber,
                owner: org,
                repo: repo,
                state: 'closed'
            })
        } catch (e) {
            fail(`Failed closing issue: ${e}`)
        }
    } else {
        if (pm.includes(suffix)) {
            try {
                core.info('Creating invitation')
                await client.orgs.createInvitation({
                    org: org,
                    invitee_id: user.data.id,
                    role: 'direct_member',
                    team_ids: [team.data.id],
                })
            } catch (e) {
                fail(`Failed creating invitation: ${e}`)
            }
            try {
                core.info('Sending notification')
                await sendNotification(client, pmUsername, name, email, pm, contract)
            } catch (e) {
                try {
                    core.info('Creating failure comment')
                    await client.issues.createComment({
                        issue_number: issueNumber,
                        owner: org,
                        repo: repo,
                        body: `Unable to send email: ${e}`
                    })
                } catch (e) {
                    fail(`Failed creating failure comment: ${e}`)
                }
            }
        } else {
            try {
                core.info('Creating failure comment')
                await client.issues.createComment({
                    issue_number: issueNumber,
                    owner: org,
                    repo: repo,
                    body: `PM/COR email must be in the ${suffix} domain, please update the original`
                })
            } catch (e) {
                fail(`Failed creating failure comment: ${e}`)
            }
            fail(`PM/COR email must be in the ${suffix} domain, please update the original information`)
        }
    }
}

async function sendNotification(client, pmUsername, name, email, pm, contract) {
    try {
        core.info('Creating success comment')
        await client.issues.createComment({
            issue_number: issueNumber,
            owner: org,
            repo: repo,
            body: successMessage
        })
        core.info(`Creating approval comment`)
        await client.issues.createComment({
            owner: org,
            repo: repo,
            issue_number: issueNumber,
            body: `@${pmUsername}\n\n${util.format(template, name, email, contract, issueNumber)}`
        })
    } catch (e) {
        fail(`Failed sending notification: ${e}`)
    }

    try {
        await client.issues.addLabels({
            owner: org,
            repo: repo,
            issue_number: issueNumber,
            labels: ['pm-notified']
        })
    } catch (e) {
        fail(`Failed adding email-sent label: ${e}`)
    }
}

function fail(e) {
    core.setFailed(e)
    process.exit(1)
}

main()
