import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StringCallerMock } from '../../typechain'

describe('StringLib,', () => {
  let stringCaller: StringCallerMock

  before(async () => {
    const CallerFactory = await ethers.getContractFactory('StringCallerMock')
    stringCaller = await (<Promise<StringCallerMock>>CallerFactory.deploy())
  })

  const asciiLower = (s: string): string =>
    Array.from(s)
      .map((c: string) => (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c))
      .join('')

  function test(input: string) {
    const lower = asciiLower(input)
    return it(`should convert "${input}" to "${lower}"`, async () => {
      expect(await stringCaller.toLower(input)).to.equal(lower)
    })
  }

  test('RTKN')
  test('USD+')
  test('AbCdEfGhIjKlMnOpQrStUvWxYz')
  test(')(*(@#*&$%^asldnoiwDDihdhQlsihdg')
  test('"中文 EspaÑol Deutsch English हिन्दी')
  test('hello ŅņŁ AbCxYz')
  test('x ц x')
  test('💩c0In')
})
