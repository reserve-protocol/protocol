import { expect } from 'chai'
import { BigNumber, Contract, ContractReceipt, ContractTransaction, Event } from 'ethers'
import { Interface, LogDescription } from 'ethers/lib/utils'

// TODO: Proper typing
const contains = (args: { [key: string]: any | undefined }, key: string, value: any): any => {
  expect(key in args).to.equal(true, `Event argument '${key}' not found`)

  if (value === null) {
    expect(args[key]).to.equal(
      null,
      `expected event argument '${key}' to be null but got ${args[key]}`
    )
  } else if (BigNumber.isBigNumber(args[key]) || BigNumber.isBigNumber(value)) {
    const actual = BigNumber.isBigNumber(args[key]) ? args[key].toString() : args[key]
    const expected = BigNumber.isBigNumber(value) ? value.toString() : value

    expect(args[key]).to.equal(
      value,
      `expected event argument '${key}' to have value ${expected} but got ${actual}`
    )
  } else {
    expect(args[key]).to.be.deep.equal(
      value,
      `expected event argument '${key}' to have value ${value} but got ${args[key]}`
    )
  }
}

// TODO: Proper typing for "eventArgs"
export const expectInReceipt = (
  receipt: ContractReceipt,
  eventName: string,
  eventArgs = {}
): any => {
  if (receipt.events == undefined) {
    throw new Error('No events found in receipt')
  }

  const events = receipt.events.filter((e: Event) => e.event === eventName)
  expect(events.length > 0).to.equal(true, `No '${eventName}' events found`)

  const exceptions: string[] = []
  const event = events.find(function (e: Event) {
    for (const [k, v] of Object.entries(eventArgs)) {
      try {
        if (e.args == undefined) {
          throw new Error('Event has no arguments')
        }

        contains(e.args, k, v)
      } catch (error) {
        exceptions.push(error as string)
        return false
      }
    }
    return true
  })

  if (event === undefined) {
    // Each event entry may have failed to match for different reasons,
    // throw the first one
    throw exceptions[0]
  }

  return event
}

export const expectInIndirectReceipt = (
  receipt: ContractReceipt,
  emitter: Interface,
  eventName: string,
  eventArgs = {}
): any => {
  const decodedEvents = receipt.logs
    .map((log) => {
      try {
        return emitter.parseLog(log)
      } catch {
        return undefined
      }
    })
    .filter((e): e is LogDescription => e !== undefined)

  const expectedEvents = decodedEvents.filter((event) => event.name === eventName)
  expect(expectedEvents.length > 0).to.equal(true, `No '${eventName}' events found`)

  const exceptions: Array<string> = []
  const event = expectedEvents.find(function (e) {
    for (const [k, v] of Object.entries(eventArgs)) {
      try {
        if (e.args == undefined) {
          throw new Error('Event has no arguments')
        }

        contains(e.args, k, v)
      } catch (error) {
        exceptions.push(error as string)
        return false
      }
    }
    return true
  })

  if (event === undefined) {
    // Each event entry may have failed to match for different reasons,
    // throw the first one
    throw exceptions[0]
  }

  return event
}

export interface IEvent {
  contract: Contract
  name: string
  args?: any[]
  emitted: boolean
}

// Checks for multiple events when executing a transaction `tx`
// Historical context: when we were using Waffle it was limited in that it could not chain emits
// TODO check to see if hardhat toolbox solved this
export const expectEvents = async (tx: Promise<ContractTransaction>, events: Array<IEvent>) => {
  for (const evt of events) {
    if (evt.emitted) {
      if (evt.args) {
        await expect(tx)
          .to.emit(evt.contract, evt.name)
          .withArgs(...evt.args)
      } else {
        await expect(tx).to.emit(evt.contract, evt.name)
      }
    } else {
      await expect(tx).to.not.emit(evt.contract, evt.name)
    }
  }
}
