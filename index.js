const core = require('@actions/core')
const nodemailer = require('nodemailer')

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

const user = core.getInput('GMAIL_USER', {required: true, trimWhitespace: true}).trim()
const from = core.getInput('GMAIL_FROM', {required: true, trimWhitespace: true}).trim()
const secret = core.getInput('GMAIL_SECRET', {required: true, trimWhitespace: true}).trim()
const template = core.getInput('GMAIL_TEMPLATE', {required: true, trimWhitespace: true}).trim()
const replyTo = core.getInput('GMAIL_REPLY_TO', {required: true, trimWhitespace: true}).trim()

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
    const filteredBody = body.substr(1, body.length - 2).replace(/\\r\\n/g, '\\n'); // Trim quotes off end and replace carriage returns
    const name = filteredBody.match(new RegExp('Full Name.+###'))[0].split('\\n\\n')[1].trim()
    const email = filteredBody.match(new RegExp('Email.+###'))[0].split('\\n\\n')[1].trim()
    const pm = filteredBody.match(new RegExp('PM/COR Email.+###'))[0].split('\\n\\n')[1].trim()

    let username = filteredBody.match(new RegExp('GitHub Username.+###'))[0].split('\\n\\n')[1].trim()
    if (username.includes('@')) {
        username = username.substr(1)
    }

    let user
    let team
    try {
        console.log(`Fetching user information for ${username}`)
        user = await client.users.getByUsername({
            username: username
        })
    } catch (e) {
        fail(`Failed fetching user information: ${e}`)
    }

    try {
        console.log(`Retrieving team information`)
        team = await client.teams.getByName({
            org: org,
            team_slug: teamName
        })
    } catch (e) {
        fail(`Failed fetching team information: ${e}`)
    }
    if (email.includes(suffix)) {
        try {
            console.log('Creating invitation')
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
                console.log('Creating invitation')
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
                console.log('Sending email')
                await sendEmail(name, email, pm)
            } catch (e) {
                try {
                    console.log('Creating failure comment')
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
                console.log('Creating failure comment')
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

    try {
        console.log('Creating success comment')
        await client.issues.createComment({
            issue_number: issueNumber,
            owner: org,
            repo: repo,
            body: successMessage
        })
    } catch (e) {
        fail(`Failed creating success comment: ${e}`)
    }
}

async function sendEmail(name, email, pm) {
    try {
        const transporter = await nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: user,
                pass: secret,
            },
        });

        await transporter.sendMail({
            from: from,
            to: pm,
            replyTo: replyTo,
            subject: "User Access Request Approval",
            text: util.format(template, name, email, issueNumber)
        })
    } catch (e) {
        fail(`Failed sending email: ${e}`)
    }

    try {
        await client.issues.addLabels({
            owner: org,
            repo: repo,
            issue_number: issueNumber,
            labels: ['email-sent']
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
