import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StringCallerMock } from '../../typechain'

describe('StringLib,', () => {
  let stringCaller: StringCallerMock

  before(async () => {
    const CallerFactory = await ethers.getContractFactory('StringCallerMock')
    stringCaller = await (<Promise<StringCallerMock>>CallerFactory.deploy())
  })

  it('should lowercase RTKN correctly', async () => {
    expect(await stringCaller.toLower('RTKN')).to.equal('rtkn')
  })

  it('should lowercase USD+ correctly', async () => {
    expect(await stringCaller.toLower('USD+')).to.equal('usd+')
  })

  it('should lowercase partially capitalized symbols correctly', async () => {
    expect(await stringCaller.toLower('AbCdEfGhIjKlMnOpQrStUvWxYz')).to.equal(
      'abcdefghijklmnopqrstuvwxyz'
    )
  })
})
