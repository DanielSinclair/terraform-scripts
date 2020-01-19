
import preferences from '@danielsinclair/preferences'
import chalk from 'chalk'
import axios from 'axios'
import tar from 'tar'
import fs from 'fs'

const DEBUG = false

const prefs = new preferences('com.danielsinclair.terraformscripts')

axios.defaults.headers.common['Authorization'] = `Bearer ${prefs.token}`

const parseModule = (dir) => {
  const modulePackage = JSON.parse(fs.readFileSync(`${dir}/package.json`).toString())
  const module = modulePackage.name
  let parsedModule = module.split('-')
  parsedModule.shift()
  const provider = parsedModule.shift()
  const name = parsedModule.join('-')
  const version = modulePackage.version
  return [module, provider, name, version]
}

const printSuccess = (message) => {
  console.log(chalk.green(message))
}

const printError = (error) => {
  console.log(chalk.red(error))
}

const printJSON = (error) => {
  const json = JSON.stringify(error)
  console.log(json)
}

const registryAPI = axios.create({
  baseURL: 'https://app.terraform.io/api/registry/v1/modules'
})

const getModule = async (org, name, provider) => {
  try {
    const response = await registryAPI.get(`/${org}/${name}/${provider}`)
    console.log(`🔎  Module ${org}/${name}/${provider} found`)
    if (DEBUG) printJSON(e.response.data)
    return response.data
  } catch (e) {
    console.log(`🔎  Module ${org}/${name}/${provider} not found`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const getModuleVersion = async (org, name, provider, version) => {
  try {
    const response = await registryAPI.get(`/${org}/${name}/${provider}/${version}`)
    console.log(`🔎  Found v${version}`)
    if (DEBUG) printJSON(response.data)
    return response.data
  } catch (e) {
    console.log(`🔎  Could not find v${version}`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const terraformCloudAPI = axios.create({
  baseURL: 'https://app.terraform.io/api/v2',
  headers: { 'Content-Type': 'application/vnd.api+json' }
})

const createModule = async (org, name, provider) => {
  try {
    const response = await terraformCloudAPI.post(`/organizations/${org}/registry-modules`, JSON.stringify({
      data: { type: 'registry-modules', attributes: { name, provider } }
    }))
    printSuccess(`✅  Created module`)
    if (DEBUG) printJSON(response.data.data)
    return response.data.data
  } catch (e) {
    printError(`❌  Failed to create module`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const createModuleVersion = async (org, name, provider, version) => {
  try {
    const response = await terraformCloudAPI.post(`/registry-modules/${org}/${name}/${provider}/versions`, JSON.stringify({
      data: { type: 'registry-module-versions', attributes: { version } }
    }))
    printSuccess(`✅  Created v${version}`)
    if (DEBUG) printJSON(response.data.data)
    return response.data.data
  } catch (e) {
    printError(`❌  Failed to create v${version}`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const createArchive = async () => {
  return await tar.create({ gzip: true }, [''])
}

const uploadModuleVersion = async (url, fileBuffer) => {
  try {
    await axios.put(url, fileBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' }
    })
    printSuccess(`✅  Uploaded package`)
    return true
  } catch (e) {
    printError(`❌  Failed to upload package`)
    if (DEBUG) console.log(e)
  }
}

const deleteModule = async (org, name, provider) => {
  try {
    await terraformCloudAPI.post(`/registry-modules/actions/delete/${org}/${name}/${provider}`)
    printSuccess(`✅  Deleted module`)
  } catch (e) {
    printError(`❌  Failed to delete module`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const deleteModuleVersion = async (org, name, provider, version) => {
  try {
    await terraformCloudAPI.post(`/registry-modules/actions/delete/${org}/${name}/${provider}/${version}`)
    printSuccess(`✅  Deleted previous v${version}`)
  } catch (e) {
    printError(`❌  Failed to delete v${version}`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const deployFunc = async (dir, org, module, provider, name, version) => {
  try {
    let registryModule = await getModule(org, name, provider)
    if (!registryModule) registryModule = await createModule(org, name, provider)
    let moduleVersion = await getModuleVersion(org, name, provider, version)
    if (moduleVersion) await deleteModuleVersion(org, name, provider, version)
    moduleVersion = await createModuleVersion(org, name, provider, version)
    const archiveFile = await createArchive()
    const uploadSucceeded = await uploadModuleVersion(moduleVersion.links.upload, archiveFile)
    await sleep(2000)
    moduleVersion = await getModuleVersion(org, name, provider, version)
    if (moduleVersion) printSuccess(`✅  Successfully deployed v${version}`)
    else printError(`❌  Failed to deploy v${version}`)
  } catch (e) {
    printError(`🚨  An unknown error occured`)
    if (DEBUG) console.error(e)
  }
}

const deleteFunc = async (dir, org, module, provider, name, version) => {
  try {
    await deleteModule(org, name, provider)
  } catch (e) {
    printError(`🚨  An unknown error occured`)
    if (DEBUG) console.error(e)
  }
}

const args = process.argv.slice(2)

const scripts = (cmd) => ({
  deploy: deployFunc,
  delete: deleteFunc
})[cmd]

try {
  const script = scripts(args[0])
  const dir = process.env.TFMDIR || process.cwd()
  const params = parseModule(dir)
  script(dir, prefs.organization, ...params, ...args.slice(1))
} catch(e) {
  console.error(e)
}