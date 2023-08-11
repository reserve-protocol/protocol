import axios from 'axios'
import hre from 'hardhat'

async function main() {
  await hre.run('compile')

  const allArtifactNames = await hre.artifacts.getAllFullyQualifiedNames()
  const fullComposite = await Promise.all(
    allArtifactNames.map((fullName) => hre.artifacts.readArtifact(fullName).then((e) => e.abi))
  )
    .then((e) => e.flat())
    .then((e) => e.map((v) => [JSON.stringify(v), v] as const))
    .then((e) => [...new Map(e).values()])

  const parsedComposite = fullComposite
    .filter((e) => ['function', 'event', 'error'].includes(e.type))
    .map((e) => {
      if (e.type === 'error') {
        // errors are same as functions
        e.type = 'function'
        e.outputs = []
      }

      return e
    })

  if (parsedComposite.length === 0) {
    return console.log('Nothing to sync!')
  }

  await axios
    .post('https://www.4byte.directory/api/v1/import-abi/', {
      contract_abi: JSON.stringify(parsedComposite),
    })
    .then(({ data }) => {
      console.log(
        `Processed ${data.num_processed} unique items from ${allArtifactNames.length} individual ABIs adding ${data.num_imported} new selectors to database with ${data.num_duplicates} duplicates and ${data.num_ignored} ignored items.`
      )
    })
    .catch((error) => {
      throw Error(`Sync failed with code ${error.response.status}!`)
    })

  console.log('Done!')
}

main().catch((error) => {
  console.error(error)

  process.exitCode = 1
})
