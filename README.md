# General

This script is used to generate M3U format files from Stalker portal streams.

# Supported features

## Media

Supported channels are :
- **TV**
- **VOD**

## Prerequisites

In order to use this script, following are needed :
- [NodeJS](https://nodejs.org/en/download)

# Usage

## Script

Run configuration script at first execution only (only to be done once or after every new version) :
- [configure.bat](./configure.bat) (_Windows_)
- [configure](./configure) (_Linux / MacOS_)

The main entrypoint to run the script is from file :
- [stalker-to-m3u.bat](./stalker-to-m3u.bat) (_Windows_)
- [stalker-to-m3u](./stalker-to-m3u) (_Linux / MacOS_)

## Stalker provider

Stalker portal provider info needs to be set into [config.json](./config.json) file.

## Commands

### Prompt 1
#### 1 - categories

**Categories listing** outputs all groups per media chosen, to the file `groups.txt`.

Use this file to remove unwanted categories to be excluded from m3u generation.

#### 2 - m3u

**M3U generation** generates and outputs all channels to the file `[m3u|vod]-<stalker-dns>.m3u`.

### Prompt 2
#### 1 - iptv

IPTV are TV channels from stalker portal.

#### 2 - vod

VOD are video-on-demand channels from stalker portal. These do not include series.

## Options (`config.json`)

Considering following stalker provider :
`http://my.dns.com:8080/stalker_portal/c/` with MAC `00:1A:79:12:34:56`

| Property                    | Description                                                                                                                                                                                                                                                                                     | Optional | Default       |
|-----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------------|
| `hostname`                  | DNS as in `my.dns.com`                                                                                                                                                                                                                                                                          |          |               |
| `port`                      | Port as in `8080` (use `80` if there is no port in the URL)                                                                                                                                                                                                                                     |          |               |
| `contextPath`               | Context path as in `stalker_portal`. Set to `""` or remove property from `config.json` if your portal has no context path (ex. `http://my.dns.com:8080/c/`).                                                                                                                                    | [X]      | `""` (_none_) |
| `mac`                       | Full mac address as in `00:1A:79:12:34:56`                                                                                                                                                                                                                                                      |          |               |
| `tvgIdPreFill`              | Try to assign a EPG tvid from existing mapping in `tvg.json`<br/>(feel free to add your own depending on your EPG provider)                                                                                                                                                                     | [X]      | `false`       |
| `computeUrlLink`            | Resolve each channel URL (otherwise set it to STB provider default which is not resolvable).<br/>Set it to `false` for M3U generation to only list channels (for EPG purpose for instance).<br/>Set it to `true` otherwise (most of the use cases).                                             | [X]      | `false`       |
| `vodMaxPagePerGenre`        | Max number of pages per category to fetch the videos from. The more pages per genre are set, the longer the generation will take.                                                                                                                                                               | [X]      | `2`           |
| `maxNumberOfChannelsToTest` | (Only if `computeUrlLink` is enabled.)<br/>Max number of channels to be picked up randomly among selected groups, and to test if streams are resolvable. If none responds successfully, the generation is aborted. Set `maxNumberOfChannelsToTest` to `0` to disable this test and always generate. | [X]      | `5`           |

### Options from command line
Options can also be passed to the script to override a value set from `config.json`, by adding `--<property>=<value>` for each desired property.

Example : `$> ./stalker-to-m3u --mac="00:1A:79:12:98:76" --vodMaxPagePerGenre=15`
