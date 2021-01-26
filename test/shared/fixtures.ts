import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { MockTimeUniswapV3Pair } from '../../typechain/MockTimeUniswapV3Pair'
import { TestERC20 } from '../../typechain/TestERC20'
import { UniswapV3Factory } from '../../typechain/UniswapV3Factory'
import { TestUniswapV3Callee } from '../../typechain/TestUniswapV3Callee'
import { TestUniswapV3Router } from '../../typechain/TestUniswapV3Router'
import { MockTimeUniswapV3PairDeployer } from '../../typechain/MockTimeUniswapV3PairDeployer'

import { Fixture } from 'ethereum-waffle'

interface FactoryFixture {
  factory: UniswapV3Factory
}

async function factoryFixture(): Promise<FactoryFixture> {
  const factoryFactory = await ethers.getContractFactory('UniswapV3Factory')
  const factory = (await factoryFactory.deploy()) as UniswapV3Factory
  return { factory }
}

interface TokensFixture {
  token0: TestERC20
  token1: TestERC20
  token2: TestERC20
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory('TestERC20')
  const tokenA = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20
  const tokenB = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20
  const tokenC = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20

  const [token0, token1, token2] = [tokenA, tokenB, tokenC].sort((tokenA, tokenB) =>
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? -1 : 1
  )

  return { token0, token1, token2 }
}

type TokensAndFactoryFixture = FactoryFixture & TokensFixture

interface PairFixture extends TokensAndFactoryFixture {
  swapTargetCallee: TestUniswapV3Callee
  swapTargetRouter: TestUniswapV3Router
  createPair(
    fee: number,
    tickSpacing: number,
    sqrtPrice: BigNumberish,
    firstToken?: TestERC20,
    secondToken?: TestERC20
  ): Promise<MockTimeUniswapV3Pair>
}

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_PAIR_START_TIME = 1601906400

export const pairFixture: Fixture<PairFixture> = async function (): Promise<PairFixture> {
  const { factory } = await factoryFixture()
  const { token0, token1, token2 } = await tokensFixture()

  const mockTimeUniswapV3PairDeployerFactory = await ethers.getContractFactory('MockTimeUniswapV3PairDeployer')
  const mockTimeUniswapV3PairFactory = await ethers.getContractFactory('MockTimeUniswapV3Pair')

  const calleeContractFactory = await ethers.getContractFactory('TestUniswapV3Callee')
  const routerContractFactory = await ethers.getContractFactory('TestUniswapV3Router')

  const swapTargetCallee = (await calleeContractFactory.deploy()) as TestUniswapV3Callee
  const swapTargetRouter = (await routerContractFactory.deploy()) as TestUniswapV3Router

  return {
    token0,
    token1,
    token2,
    factory,
    swapTargetCallee,
    swapTargetRouter,
    createPair: async (fee, tickSpacing, sqrtPrice, firstToken = token0, secondToken = token1) => {
      const mockTimePairDeployer = (await mockTimeUniswapV3PairDeployerFactory.deploy()) as MockTimeUniswapV3PairDeployer
      const tx = await mockTimePairDeployer.deploy(
        factory.address,
        firstToken.address,
        secondToken.address,
        fee,
        tickSpacing,
        sqrtPrice
      )

      const receipt = await tx.wait()
      const pairAddress = receipt.events?.[0].args?.pair as string
      return mockTimeUniswapV3PairFactory.attach(pairAddress) as MockTimeUniswapV3Pair
    },
  }
}
