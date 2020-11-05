// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.6.12;

import '@uniswap/lib/contracts/libraries/FixedPoint.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

import '../libraries/PriceMath.sol';
import '../libraries/TickMath.sol';

contract PriceMathEchidnaTest {
    using SafeMath for uint256;

    function getAmountOutInvariants(
        uint112 reserveIn,
        uint112 reserveOut,
        uint112 amountIn
    ) external pure {
        require(reserveIn > 0 && reserveOut > 0);

        uint112 amountOut = PriceMath.getAmountOut(reserveIn, reserveOut, amountIn);
        assert(amountOut < reserveOut);

        uint256 k = uint256(reserveIn).mul(reserveOut);
        uint256 reserveInAfter = uint256(reserveIn).add(amountIn);
        uint256 reserveOutAfter = uint256(reserveOut).sub(amountOut);
        uint256 kAfter = reserveInAfter.mul(reserveOutAfter);
        assert(kAfter >= k);
    }

    function getInputToRatioInvariants(
        uint112 reserve0,
        uint112 reserve1,
        uint16 lpFee,
        int16 tick,
        bool zeroForOne
    ) external pure {
        // UniswapV3Pair.TOKEN_MIN
        require(reserve0 >= 101 && reserve1 >= 101);
        require(lpFee < PriceMath.LP_FEE_BASE);
        require(tick >= TickMath.MIN_TICK && tick < TickMath.MAX_TICK);
        FixedPoint.uq112x112 memory priceTarget = TickMath.getRatioAtTick(tick);

        FixedPoint.uq112x112 memory priceBefore = FixedPoint.fraction(reserve1, reserve0);

        (uint112 amountIn, uint112 reserveOutMinimum) = PriceMath.getInputToRatio(
            reserve0,
            reserve1,
            lpFee,
            priceTarget,
            zeroForOne
        );

        if (amountIn == 0) {
            // amountIn should only be 0 if the current price gte the inOutRatio
            if (zeroForOne) assert(priceBefore._x <= priceTarget._x);
            else assert(priceBefore._x >= priceTarget._x);
        } else {
            uint112 amountInLessFee = uint112(
                (uint256(amountIn) * (PriceMath.LP_FEE_BASE - lpFee)) / PriceMath.LP_FEE_BASE
            );
            uint112 amountOut = zeroForOne
                ? PriceMath.getAmountOut(reserve0, reserve1, amountInLessFee)
                : PriceMath.getAmountOut(reserve1, reserve0, amountInLessFee);

            // downward-adjust amount out if necessary
            amountOut = uint112(Math.min(amountOut, (zeroForOne ? reserve1 : reserve0) - reserveOutMinimum));

            (uint112 reserve0Next, uint112 reserve1Next) = zeroForOne
                ? (reserve0 + amountInLessFee, reserve1 - amountOut)
                : (reserve0 - amountOut, reserve1 + amountInLessFee);

            // check that the price does not exceed the next price
            {
                FixedPoint.uq112x112 memory priceAfterSwap = FixedPoint.fraction(reserve1Next, reserve0Next);
                if (zeroForOne) assert(priceAfterSwap._x >= priceTarget._x);
                else assert(priceAfterSwap._x <= priceTarget._x);
            }

            (reserve0Next, reserve1Next) = zeroForOne
                ? (
                    reserve0 + amountInLessFee + 1,
                    reserve1 - amountOut - PriceMath.getAmountOut(reserve0 + amountInLessFee, reserve1 - amountOut, 1)
                )
                : (
                    reserve0 - amountOut - PriceMath.getAmountOut(reserve1 + amountInLessFee, reserve0 - amountOut, 1),
                    reserve1 + amountInLessFee + 1
                );

            // check that one more wei of effective amount in would result in a price that exceeds the next price
            {
                FixedPoint.uq112x112 memory priceAfterSwap1MoreWei = FixedPoint.fraction(reserve1Next, reserve0Next);
                if (zeroForOne) assert(priceAfterSwap1MoreWei._x < priceTarget._x);
                else assert(priceAfterSwap1MoreWei._x > priceTarget._x);
            }
        }
    }
}
