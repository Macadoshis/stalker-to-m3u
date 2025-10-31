[![BUILD](https://github.com/Macadoshis/stalker-to-m3u/actions/workflows/ci.yml/badge.svg)](https://github.com/Macadoshis/stalker-to-m3u/actions/workflows/ci.yml)
[![SETUP](https://github.com/Macadoshis/stalker-to-m3u/actions/workflows/setup.yml/badge.svg)](https://github.com/Macadoshis/stalker-to-m3u/actions/workflows/setup.yml)
[![TESTS](https://github.com/Macadoshis/stalker-to-m3u/actions/workflows/tests.yml/badge.svg)](https://github.com/Macadoshis/stalker-to-m3u/actions/workflows/tests.yml)

<a href="https://www.buymeacoffee.com/macadoshis" target="_blank" rel="noopener">
<img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="27" width="116">
</a>

# General

This script is used to generate M3U format files from Stalker portal streams.

## Advantages

- Way more desktop and mobile software (mostly freewares), as well as some browsers, support the **M3U** format compared
  to the **Stalker** (ministra) format.
- It is easier to manage favorites and **download streams locally** for offline viewing (especially VOD and Series), and
  stream playback is smoother than some stalker reader which does not handle lost signal correctly forcing you to replay
  again a stream from the beginning.
- This generation tool allows adding features not natively supported by Stalker players, such as EPG association and
  sorting VOD content based on multiple criteria.
- Additionally, loading an M3U file is significantly faster than a Stalker provider, which systematically loads the
  entire catalog. This tool enables you to select only the genres and categories that interest you, allowing you to
  exclude channels from other countries or adult content categories.

## Disadvantages

- The M3U format generation is static and reflects the resources available from the Stalker provider at the time of
  generation. There is no synchronization with provider updates (new channels, VOD additions, etc.). There is also no
  clear way to determine if a resource has expired or is no longer compatible, except that the M3U streams will stop
  playing.
- The M3U8 standard is restricted to very little information (title, group, duration) and cannot hold all the meta from
  a stalker resource such as synopsis, actors, genre, ...
- Furthermore, the streams generated for the M3U rely on a token obtained at the time of generation. Generally, this
  token has an infinite lifespan, but some providers may enforce a limited duration, causing the M3U to expire and
  requiring a new generation.

# Disclaimers

## Purpose

This project is intended solely for educational purposes, to demonstrate techniques for web scraping and parsing
publicly available data, and conversion from stalker to M3U protocols.

It is not intended to be used for accessing or distributing copyrighted materials without authorization.

## Usage

This tool does not endorse or condone illegal activities.

The project author is not responsible for how this software is used by others.

Users of this software must comply with all applicable laws, including copyright laws, in their jurisdiction.

## Responsibility

The author of this project assumes no responsibility for any unauthorized use of this tool.

Users are solely responsible for determining the legality of their actions.

## Contributions guidelines

Contributions that promote or enable the unauthorized access to copyrighted materials will not be accepted.

# Supported features

## Media

Supported channels are :

- **TV**
- **VOD**
- **SERIES**

## Prerequisites

In order to use this script, following are needed :

- [NodeJS](https://nodejs.org/en/download)

# Usage

## Script

### Prerequisite

Run configuration script at first execution only (only to be done once or after every new version) :

- [configure.bat](./configure.bat) (_Windows_)
- [configure](./configure) (_Linux / MacOS_)

The `configure` script performs in that order :

- download the dependencies for NodeJS to `node_modules` directory.
- download the ffmpeg binaries (`ffmpeg` and `ffprobe`). Note that a failure at this point will prevent from using the
  tools with config by default, in that case set the `streamTester` option to `http` (default value is `ffmpeg`).

### Main entry

The main entrypoint to run the script is from file :

- [stalker-to-m3u.bat](./stalker-to-m3u.bat) (_Windows_)
- [stalker-to-m3u](./stalker-to-m3u) (_Linux / MacOS_)

## Stalker provider

Stalker portal provider info needs to be set into [config.json](./config.json) file.

It is the responsibility of the user to use legal stalker portal sources.

## Commands

### Prompt 1

#### 1 - categories

**Categories listing** outputs all groups per media chosen, to the file `groups-<mode>.txt` (ex. `groups-iptv.txt`).

Use this file to remove unwanted categories to be excluded from m3u generation.

Only delete undesired lines. Do not manually edit or add entries in the file `groups-<mode>.txt`.

#### 2 - m3u

**M3U generation** generates and outputs all channels to the file `[m3u|vod]-<stalker-dns>.m3u`.

### Prompt 2

#### 1 - iptv

IPTV are TV channels from stalker portal.

Basic EPG mapping based on keys from https://m3u4u.com/
(currently supported channels are: French-FRANCE, French-CANADA, English-CANADA, Swiss, Morocco).
Mapping can be updated by editing [tvg.json](./tvg.json).

#### 2 - vod

VOD are video-on-demand channels from stalker portal.

#### 3 - series

SERIES are TV shows from stalker portal.

## Options (`config.json`)

Considering following stalker provider :
`http://my.dns.com:8080/stalker_portal/c/` with MAC `00:1F:BD:12:34:56`

| Property                    | Description                                                                                                                                                                                                                                                                                         | Optional | Default                                       |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|-----------------------------------------------|
| `hostname`                  | DNS as in `my.dns.com`                                                                                                                                                                                                                                                                              |          |                                               |
| `port`                      | Port as in `8080` (use `80` if there is no port in the URL)                                                                                                                                                                                                                                         |          |                                               |
| `contextPath`               | Context path as in `stalker_portal`. Set to `""` or remove property from `config.json` if your portal has no context path (ex. `http://my.dns.com:8080/c/`).                                                                                                                                        | &#x2713; | `""` (_none_)                                 |
| `mac`                       | Full mac address as in `00:1F:BD:12:34:56`                                                                                                                                                                                                                                                          |          |                                               |
| `outputDir`                 | Output directory of generated M3U files                                                                                                                                                                                                                                                             | &#x2713; | `.`                                           |
| `deviceId1`                 | Device ID 1                                                                                                                                                                                                                                                                                         | &#x2713; | Random auto-generated ID of 64 hex characters |
| `deviceId2`                 | Device ID 2                                                                                                                                                                                                                                                                                         | &#x2713; | Device ID 1                                   |
| `serialNumber`              | Serial number                                                                                                                                                                                                                                                                                       | &#x2713; | Random auto-generated ID of 13 hex characters |
| `tvgIdPreFill`              | Try to assign a EPG tvid from existing mapping in `tvg.json`<br/>(feel free to add your own depending on your EPG provider)                                                                                                                                                                         | &#x2713; | `false`                                       |
| `computeUrlLink`            | Resolve each channel URL (otherwise set it to STB provider default which is not resolvable).<br/>Set it to `false` for M3U generation to only list channels (for EPG purpose for instance).<br/>Set it to `true` otherwise (most of the use cases).                                                 | &#x2713; | `true`                                        |
| `delayBetweenUrlGeneration` | Delay in milliseconds to wait between URL generation requests (throttle).<br>Use this for provider likely to be defensive against closed requests (HTTP 429).                                                                                                                                       | &#x2713; | `0` (ms)                                      |
| `tokenCacheDuration`        | Max duration in seconds to cache an authorization token before requesting another handshake of authentication.                                                                                                                                                                                      | &#x2713; | `300` (s)                                     |
| `vodMaxPagePerGenre`        | Max number of pages per category to fetch the videos from. The more pages per genre are set, the longer the generation will take.                                                                                                                                                                   | &#x2713; | `2`                                           |
| `vodIncludeRating`          | Include IMDB rating in the title of each VOD (if provided).                                                                                                                                                                                                                                         | &#x2713; | `true`                                        |
| `vodOrdering`               | Indicate the sorting of each VOD item.<br/> Possible values are `none` (as given by provider), `alphabetic` (by VOD title) or `rating` (by IMDB rating where provided, _alphabetically_ for items with no rating).                                                                                  | &#x2713; | `alphabetic`                                  |
| `maxNumberOfChannelsToTest` | (Only if `computeUrlLink` is enabled.)<br/>Max number of channels to be picked up randomly among selected groups, and to test if streams are resolvable. If none responds successfully, the generation is aborted. Set `maxNumberOfChannelsToTest` to `0` to disable this test and always generate. | &#x2713; | `5`                                           |
| `streamTester`              | (Only if `maxNumberOfChannelsToTest` is greater than 0)<br/>Stream tester mode. One of value `http` or `ffmpeg`.                                                                                                                                                                                    | &#x2713; | `ffmpeg`                                      |
| `testM3uFile`               | Whether to test the M3U file after generation.                                                                                                                                                                                                                                                      | &#x2713; | `true`                                        |

### Options from command line

Options can also be passed to the script to override a value set from `config.json`, by adding `--<property>=<value>`
for each desired property.

Example : `$> ./stalker-to-m3u --mac="00:1F:BD:12:98:76" --vodMaxPagePerGenre=15`

## Stalker providers analyzer

A tool acting as a web scraper can crawl content to look for all http stalker portals and corresponding MAC addresses.

### Prerequisite

Create and fill the file [tools/sources.txt](./tools/sources.txt) with external sources.

Supported formats are web pages (`http://` or `https://`) or local files (`file:///`) with textual content (useful for
non-public or restricted web pages).

### Script

Run the following script :

- [tools/iptv-analyzer.bat](./tools/iptv-analyzer.bat) (_Windows_)
- [tools/iptv-analyzer](./tools/iptv-analyzer) (_Linux / MacOS_)

### Principles

The script looks for all **http** and **MAC** providers and tests for each the liveness of the IPTV provider, against
_N_ random groups and _N_ random channels.

The number of groups and channels to fetch against can be configured through config
file [tools/analyzer-config.json](./tools/analyzer-config.json).

| Property         | Description                                                                                                                                                         | Optional | Default  |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|----------|
| `cache`          | Whether or not to test again a provider if it is already listed either in `succeeded.json` or `failed.json` upon subsequent relaunching of the script.              | &#x2713; | `false`  |
| `groupsToTest`   | Number of IPTV groups to fetch channels from.<br/>The group(s) are selected randomly among all IPTV genres of the provider.                                         | &#x2713; | `1`      |
| `channelsToTest` | Number of IPTV channels to check the liveness.<br/>The channel(s) are selected randomly among all channels from the result of selected genres (see `groupsToTest`). | &#x2713; | `1`      |
| `threadsCount`   | Number of providers to analyze in parallel.                                                                                                                         | &#x2713; | `10`     |
| `streamTester`   | Stream tester mode. One of value `http` or `ffmpeg`.                                                                                                                | &#x2713; | `ffmpeg` |

A provider is considered live if at least ONE channel stream resolves successfully.

### Outputs

After the execution of the script, the following files are created :

| File                   | Description                                                                                                                                                                                              |
|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| _tools/succeeded.json_ | A set of all resolving providers with following entries : `hostname`, `port`, `contextPath` and `mac`.<br/>Entries can be put selectively and manually into [config.json](./config.json) for processing. |
| _tools/failed.json_    | A set of all **un**resolving providers with following entries : `url` and `mac`.                                                                                                                         |

## M3U files checker

Verify the health of a single M3U file or all M3U files in a given location, through specific criteria.

### Prerequisite

M3U file or location must exist locally.

### Script

Run the following script :

- [tools/m3u-tester.bat](./tools/m3u-tester.bat) (_Windows_)
- [tools/m3u-tester](./tools/m3u-tester) (_Linux / MacOS_)

### Principles

The script looks for all M3U files in a given location or a single M3U file, and test its stream health to assert or not
the global
health of the M3U file through specific customizable criteria.

The criteria can be configured through config file [m3u-tester-config.json](tools/m3u-tester-config.json).

| Property          | Description                                                                                                       | Optional | Default      |
|-------------------|-------------------------------------------------------------------------------------------------------------------|----------|--------------|
| `m3uLocation`     | M3U location. Can be a file or a directory.                                                                       | &#x2713; | `.`          |
| `maxFailures`     | Maximal number of failures before marking a M3U file as failed. Deactivate testing upon failures with value -1.   | &#x2713; | `10`         |
| `minSuccess`      | Minimal number of failures before marking a M3U file as succeeded. Deactivate testing upon success with value -1. | &#x2713; | `1`          |
| `renameOnFailure` | Whether to rename a failed M3U by prefixing with 'renamePrefix'.                                                  | &#x2713; | `false`      |
| `renamePrefix`    | Prefix to rename a failed M3U (only if 'renameOnFailure' is set to true).                                         | &#x2713; | `UNHEALTHY_` |
| `retestSuccess`   | Whether to test again the success.json content (if file exists).                                                  | &#x2713; | `false`      |
| `threadsCount`    | Number of M3U to process in parallel.                                                                             | &#x2713; | `1`          |
| `streamTester`    | Stream tester mode. One of value `http` or `ffmpeg`.                                                              | &#x2713; | `ffmpeg`     |

### Outputs

After the execution of the script, M3U unhealthy file(s) are renamed with a prefix if `renameOnFailure` is set to
`true`.

## M3U files generator (from analyzer)

**(Experimental)**

Loop through the `tools/succeeded.json` output from [Stalker providers analyzer](#stalker-providers-analyzer) to
generate a M3U file for each entry.
The groups are auto-selected from preference criteria by an AI prompt using AI Gemini.

### Prerequisite

File `tools/succeeded.json` must exist.

An AI Gemini key is needed (https://aistudio.google.com/apikey). A free usage key is enough for
`gemini-2.5-flash-preview-05-20` (the model can be changed).

### Script

Run the following script :

- [tools/iptv-generator.bat](./tools/iptv-generator.bat) (_Windows_)
- [tools/iptv-generator](./tools/iptv-generator) (_Linux / MacOS_)

and answer the prompt to generate for either mode: _iptv_, _vod_ or _series_.

### Principles

The script loops through all entries of file _tools/succeeded.json_ to run `stalker-to-m3u` and apply automatically the
_groups_ then _m3u_.

The groups are filtered by AI Gemini based on given customizable criteria within configuration
file [generator-config.json](tools/generator-config.json).

| Property                 | Description                                                                                              | Optional | Default                          | Examples                     |
|--------------------------|----------------------------------------------------------------------------------------------------------|----------|----------------------------------|------------------------------|
| `geminiAiKey`            | Google GEMINI AI key.                                                                                    |          |                                  |                              |
| `geminiAiModel`          | Google GEMINI AI model (supported by your key).                                                          | &#x2713; | `gemini-2.5-flash-preview-05-20` |                              |
| `outputDir`              | Output directory of generated M3U files                                                                  | &#x2713; | `.`                              |                              |
| `languages`              | Array of languages to support criteria. Not applied if unset.                                            | &#x2713; | `[]`                             | "English"                    |
| `maxOutputs`             | Max entries to generate from succeeded.json. Skipped existing m3u files are not considered.              | &#x2713; | `-1`                             |                              |
| `iptv/countries`         | List of countries for which to fetch channels for. They need to be spelled in English.                   |          |                                  | "UK", "US", "Canada"         |
| `iptv/excludedGroups`    | List of channels groups to exclude. They need to be spelled in English. Not applied if unset.            | &#x2713; | `[]`                             | "Adults", "Reality", "Music" |
| `vod/includedCategories` | List of categories of VOD for which to fetch movies for. They need to be spelled in English.             |          |                                  | "Comedy", "Horror"           |
| `vod/excludedCategories` | List of categories of VOD to exclude. They need to be spelled in English. Not applied if unset.          | &#x2713; | `[]`                             | "Netflix", "Adults", "Apple" |
| `series/includedSeries`  | List of series or themes of series to fetch. They need to be spelled in English.                         |          |                                  | "Breaking Bad"               |
| `series/excludedSeries`  | List of series or themes of series to exclude. They need to be spelled in English. Not applied if unset. | &#x2713; | `[]`                             | "Season 1", "Season 2"       |

### Outputs

After the execution of the script, M3U file(s) are generated for each provider and requested mode.