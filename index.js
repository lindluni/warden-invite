const core = require('@actions/core')

const {Octokit} = require("@octokit/rest")
const {retry} = require("@octokit/plugin-retry");
const {throttling} = require("@octokit/plugin-throttling");

const body = core.getInput('BODY', {required: true})
const org = core.getInput('ORG', {required: true, trimWhitespace: true})
const teamName = core.getInput('TEAM', {required: true, trimWhitespace: true})
const repo = core.getInput('REPO', {required: true, trimWhitespace: true})
const suffix = core.getInput('SUFFIX', {required: true, trimWhitespace: true})
const issueNumber = Number(core.getInput('ISSUE_NUMBER', {required: true, trimWhitespace: true}))
const token = core.getInput('TOKEN', {required: true, trimWhitespace: true})
const successMessage = core.getInput('SUCCESS_MESSAGE', {required: true, trimWhitespace: true})


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
    const name = body.match(new RegExp('Full Name.+###'))[0].split('\\n\\n')[1].trim()
    const email = body.match(new RegExp('Email.+###'))[0].split('\\n\\n')[1].trim()
    const pm = body.match(new RegExp('PM/COR Email.+'))[0].split('\\n\\n')[1].trim()
    let username = body.match(new RegExp('GitHub Username.+###'))[0].split('\\n\\n')[1].trim()
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
            console.log('Closing issue as it requires no approval')
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
                console.log('Creating approval comment')
                await client.issues.createComment({
                    issue_number: issueNumber,
                    owner: org,
                    repo: repo,
                    body: `/approve --pm ${pm} --name ${name} --email ${email}`
                })
            } catch (e) {
                fail(`Failed creating approval comment: ${e}`)
            }
        } else {
            const inputs = {
                name: name,
                email: email,
                username: username,
                pm: pm
            }
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
            core.setFailed(`PM/COR: ${JSON.stringify(inputs)}`)
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

function fail(e) {
    core.setFailed(e)
    process.exit(1)
}

main()
