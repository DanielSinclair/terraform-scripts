
import preferences from '@danielsinclair/preferences'
import program from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import tar from 'tar'
import fs from 'fs'
import packageJSON from './package.json'

const prefs = new preferences('com.danielsinclair.terraformscripts')

const DEBUG = process.env.TFCLOUD_DEBUG || false
const ORG = process.env.TFCLOUD_ORG || prefs.organization
const TOKEN = process.env.TFCLOUD_TOKEN || prefs.token

const parseModule = (dir) => {
  const modulePackage = JSON.parse(fs.readFileSync(`${dir}/package.json`).toString())
  const _module = modulePackage.name
  let parsedModule = _module.split('-')
  parsedModule.shift()
  const provider = parsedModule.shift()
  const name = parsedModule.join('-')
  const version = modulePackage.version
  return [_module, provider, name, version]
}

const DIR = process.cwd()
const [,PROVIDER, NAME, VERSION] = parseModule(DIR)

axios.defaults.headers.common['Authorization'] = `Bearer ${TOKEN}`

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

const getModule = async () => {
  try {
    const response = await registryAPI.get(`/${ORG}/${NAME}/${PROVIDER}`)
    console.log(`🔎  Module ${ORG}/${NAME}/${PROVIDER} found`)
    if (DEBUG) printJSON(e.response.data)
    return response.data
  } catch (e) {
    console.log(`🔎  Module ${ORG}/${NAME}/${PROVIDER} not found`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const getModuleVersion = async () => {
  try {
    const response = await registryAPI.get(`/${ORG}/${NAME}/${PROVIDER}/${VERSION}`)
    console.log(`🔎  Found v${VERSION}`)
    if (DEBUG) printJSON(response.data)
    return response.data
  } catch (e) {
    console.log(`🔎  Could not find v${VERSION}`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const terraformCloudAPI = axios.create({
  baseURL: 'https://app.terraform.io/api/v2',
  headers: { 'Content-Type': 'application/vnd.api+json' }
})

const createModule = async () => {
  try {
    const response = await terraformCloudAPI.post(`/organizations/${ORG}/registry-modules`, JSON.stringify({
      data: { type: 'registry-modules', attributes: { name: NAME, provider: PROVIDER } }
    }))
    printSuccess(`✅  Created module`)
    if (DEBUG) printJSON(response.data.data)
    return response.data.data
  } catch (e) {
    printError(`❌  Failed to create module`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const createModuleVersion = async () => {
  try {
    const response = await terraformCloudAPI.post(`/registry-modules/${ORG}/${NAME}/${PROVIDER}/versions`, JSON.stringify({
      data: { type: 'registry-module-versions', attributes: { version: VERSION } }
    }))
    printSuccess(`✅  Created v${VERSION}`)
    if (DEBUG) printJSON(response.data.data)
    return response.data.data
  } catch (e) {
    printError(`❌  Failed to create v${VERSION}`)
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

const deleteModule = async () => {
  try {
    await terraformCloudAPI.post(`/registry-modules/actions/delete/${ORG}/${NAME}/${PROVIDER}`)
    printSuccess(`✅  Deleted module`)
  } catch (e) {
    printError(`❌  Failed to delete module`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const deleteModuleVersion = async () => {
  try {
    await terraformCloudAPI.post(`/registry-modules/actions/delete/${ORG}/${NAME}/${PROVIDER}/${VERSION}`)
    printSuccess(`✅  Deleted previous v${VERSION}`)
  } catch (e) {
    printError(`❌  Failed to delete v${VERSION}`)
    if (DEBUG) printJSON(e.response.data.errors[0])
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

program
.name(packageJSON.name)
.version(packageJSON.version)

program
.command('delete')
.action(async () => {
  try {
    await deleteModule()
  } catch (e) {
    printError(`🚨  An unknown error occured`)
    if (DEBUG) console.error(e)
  }
})

program
.command('deploy')
.action(async () => {
  try {
    let registryModule = await getModule()
    if (!registryModule) registryModule = await createModule()
    let moduleVersion = await getModuleVersion()
    if (moduleVersion) await deleteModuleVersion()
    moduleVersion = await createModuleVersion()
    const archiveFile = await createArchive()
    const uploadSucceeded = await uploadModuleVersion(moduleVersion.links.upload, archiveFile)
    await sleep(2000)
    moduleVersion = await getModuleVersion()
    if (moduleVersion) printSuccess(`✅  Successfully deployed v${VERSION}`)
    else printError(`❌  Failed to deploy v${VERSION}`)
  } catch (e) {
    printError(`🚨  An unknown error occured`)
    if (DEBUG) console.error(e)
  }
})

program.parse(process.argv)