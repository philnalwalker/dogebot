# Dogebot

## Purpose

Automatically buy and sell Dogecoin using Binance.

## Strategy

5m candlestick update intervals

If MFI >= 100 and next candle is bullish (close > open) then:

   - Place a market buy order
   - Create a one cancel's the other sell order with target 10% sell price and stop-loss at lowest price of the day
   - Sell after 60 minutes if we have not already sold the share(s)
