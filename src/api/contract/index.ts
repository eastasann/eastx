/**
 * CMS API のコントラクト（パス・入出力・エラー）。SDD 5章が正で、形を変えるときは SDD を先に直す。
 * パスはベースパス `/api/admin` からの相対（src/api/app.ts の OpenAPIHandler の prefix）。
 */
import { careersContract } from './careers'
import { dashboardContract } from './dashboard'
import { openapiContract, slugsContract, uploadsContract } from './misc'
import { projectsContract, worksContract } from './portfolio'
import { blogPostsContract, codingLogsContract } from './posts'
import { profileContract } from './profile'
import { stacksContract } from './stacks'

export const contract = {
  dashboard: dashboardContract,
  profile: profileContract,
  careers: careersContract,
  works: worksContract,
  projects: projectsContract,
  stacks: stacksContract,
  blogPosts: blogPostsContract,
  codingLogs: codingLogsContract,
  slugs: slugsContract,
  uploads: uploadsContract,
  openapi: openapiContract,
}

export type Contract = typeof contract
