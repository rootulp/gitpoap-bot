import { Context, Probot } from 'probot';
import { fetch } from 'cross-fetch';
import * as Sentry from '@sentry/node';

/* @probot/pino automatically picks up SENTRY_DSN from .env */
Sentry.init({
  environment: process.env.NODE_ENV,
  /* Do not send errors to sentry if app is in development mode */
  enabled: process.env.NODE_ENV !== 'development',
  tracesSampleRate: 1.0,
});

// Should be the same as in gitpoap-backend/src/routes/claims.ts
type BotClaimData = {
  id: number;
  gitPOAP: { id: number; poapEventId: number; threshold: number };
  name: string;
  imageUrl: string;
  description: string;
};

function generateComment(claims: BotClaimData[]): string {
  let qualifier: string;
  if (claims.length > 1) {
    qualifier = `some GitPOAPs`;
  } else {
    qualifier = `a GitPOAP`;
  }

  let comment = `Woohoo, your important contribution to this open-source project has earned you ${qualifier}!\n`;

  for (const claim of claims) {
    comment += `
[**${claim.name}**](https://www.gitpoap.io/gp/${claim.gitPOAP.id}):
<img alt="${claim.name} GitPOAP Badge" src="${claim.imageUrl}" height="200px">`;
  }

  comment +=
    '\n\nHead on over to [GitPOAP.io](https://www.gitpoap.io) and connect your GitHub account to mint!';

  return comment;
}

export default (app: Probot) => {
  app.on('pull_request.closed', async (context: Context<'pull_request.closed'>) => {
    // Don't handle closed but not merged PRs
    if (!context.payload.pull_request.merged) {
      return;
    }

    const repo = context.payload.repository.name;
    const owner = context.payload.repository.owner.login;
    const pullRequestNumber = context.payload.number;

    context.log.info(
      `Handling newly merged PR: https://github.com/${owner}/${repo}/${pullRequestNumber}`,
    );

    // Skip claims creation API request if the creator of the PR is a bot
    if (context.payload.pull_request.user.type === 'Bot') {
      context.log.info(
        `Skipping creating claims for PR made by bot "${context.payload.pull_request.user.login}"`
      );
      return;
    }

    const octokit = await app.auth(); // Not passing an id returns a JWT-authenticated client
    const jwt = (await octokit.auth({ type: 'app' })) as { token: string };

    const res = await fetch(`${process.env.API_URL}/claims/gitpoap-bot/create`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt.token}`,
      },
      body: JSON.stringify({
        repo,
        owner,
        pullRequestNumber,
      }),
    });

    if (res.status !== 200) {
      context.log.error(`An issue occurred (response code: ${res.status}): ${await res.text()}`);
      return;
    }

    const response = await res.json();

    if (response.newClaims.length === 0) {
      context.log.info('No new claims were created by this PR');
      return;
    }

    context.log.info(`${response.newClaims.length} new Claims were created by this PR`);

    const issueComment = context.issue({
      body: generateComment(response.newClaims),
    });

    const result = await context.octokit.issues.createComment(issueComment);

    context.log.info(`Posted comment about new claims: ${result.data.html_url}`);
  });

  // Useful for testing purposes:
  //
  //  app.on('pull_request.closed', async (context) => {
  //    const pullRequestNum = context.payload.pull_request.number;
  //    const issueComment = context.issue({
  //      body: `Thanks for CLOSING PR #${pullRequestNum}!`,
  //    });
  //
  //    context.log.info(context.payload.repository.owner);
  //
  //    context.log.info('PR HAS BEEN CLOSED');
  //    await context.octokit.issues.createComment(issueComment);
  //  });
};
