import * as core from '@actions/core';

type Tag = {
  name: string;
  commit: { sha: string; url: string };
  zipball_url: string;
  tarball_url: string;
  node_id: string;
};

export type CompareCommit = {
  sha: string;
  commit: { message: string };
};

// Dynamic import to support @actions/github v9 (ESM-only); types kept loose to avoid pulling in node_modules .d.ts that require newer TS
interface OctokitInstance {
  rest: {
    repos: {
      listTags: (params: { owner: string; repo: string; per_page: number; page: number }) => Promise<{ data: Tag[] }>;
      compareCommits: (params: { owner: string; repo: string; base: string; head: string }) => Promise<{ data: { commits: CompareCommit[] } }>;
    };
    git: {
      createTag: (params: { owner: string; repo: string; tag: string; message: string; object: string; type: string }) => Promise<{ data: { sha: string } }>;
      createRef: (params: { owner: string; repo: string; ref: string; sha: string }) => Promise<unknown>;
    };
  };
}

let _github: { getOctokit: (token: string) => OctokitInstance; context: { repo: { owner: string; repo: string } } } | null = null;
let octokitSingleton: OctokitInstance | undefined;

// Use variable so TS 4.4 does not resolve module and parse @octokit ESM .d.ts
const githubModulePath: string = '@actions/github';

async function getGithub(): Promise<NonNullable<typeof _github>> {
  if (!_github) {
    _github = (await import(githubModulePath)) as NonNullable<typeof _github>;
  }
  return _github;
}

export async function getOctokitSingleton() {
  if (octokitSingleton) {
    return octokitSingleton;
  }
  const { getOctokit } = await getGithub();
  const githubToken = core.getInput('github_token');
  octokitSingleton = getOctokit(githubToken);
  return octokitSingleton;
}

/**
 * Fetch all tags for a given repository recursively
 */
export async function listTags(
  shouldFetchAllTags = false,
  fetchedTags: Tag[] = [],
  page = 1
): Promise<Tag[]> {
  const octokit = await getOctokitSingleton();
  const { context } = await getGithub();

  const tags = await octokit.rest.repos.listTags({
    ...context.repo,
    per_page: 100,
    page,
  });

  if (tags.data.length < 100 || shouldFetchAllTags === false) {
    return [...fetchedTags, ...tags.data];
  }

  return listTags(shouldFetchAllTags, [...fetchedTags, ...tags.data], page + 1);
}

/**
 * Compare `headRef` to `baseRef` (i.e. baseRef...headRef)
 * @param baseRef - old commit
 * @param headRef - new commit
 */
export async function compareCommits(baseRef: string, headRef: string) {
  const octokit = await getOctokitSingleton();
  const { context } = await getGithub();
  core.debug(`Comparing commits (${baseRef}...${headRef})`);

  const commits = await octokit.rest.repos.compareCommits({
    ...context.repo,
    base: baseRef,
    head: headRef,
  });

  return commits.data.commits;
}

export async function createTag(
  newTag: string,
  createAnnotatedTag: boolean,
  GITHUB_SHA: string
) {
  const octokit = await getOctokitSingleton();
  const { context } = await getGithub();
  let annotatedTag: { data: { sha: string } } | undefined = undefined;
  if (createAnnotatedTag) {
    core.debug(`Creating annotated tag.`);
    annotatedTag = await octokit.rest.git.createTag({
      ...context.repo,
      tag: newTag,
      message: newTag,
      object: GITHUB_SHA,
      type: 'commit',
    });
  }

  core.debug(`Pushing new tag to the repo.`);
  await octokit.rest.git.createRef({
    ...context.repo,
    ref: `refs/tags/${newTag}`,
    sha: annotatedTag ? annotatedTag.data.sha : GITHUB_SHA,
  });
}
