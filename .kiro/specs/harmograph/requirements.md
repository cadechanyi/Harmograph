# Requirements Document

## Introduction

Harmograph is an open-source web application that renders the musical components of a song as live, interactive mathematical graphs, conceptually similar to a Desmos graphing experience but driven by audio. As a song plays, a shared horizontal axis represents time synced to playback, and each musical stem (drums, melody, bass, vocals, chords) is mapped to its own animated graphical representation on a canvas. Users can upload an audio file, separate it into stems, view per-stem analysis as animated graphs, toggle stems on and off, switch the visual style of each stem, and read out tempo and key information.

This document defines the requirements for the Minimum Viable Product (MVP). The MVP covers file upload, in-browser audio analysis, server-side stem separation, stem-aware graph rendering, and playback/visual controls. Spotify integration, user accounts, and saving or sharing graphs are explicitly out of scope for this document and are deferred to a later release.

## Glossary

- **Harmograph_App**: The complete web application, comprising the frontend and the stem separation backend.
- **Frontend**: The Next.js (App Router) browser application that handles upload, audio analysis, rendering, and user controls.
- **Demucs_Service**: The Dockerized Python FastAPI microservice that performs stem separation using Facebook's Demucs model, deployed independently of the Frontend.
- **Audio_Engine**: The Frontend subsystem that decodes and plays audio using the Web Audio API.
- **Analysis_Engine**: The Frontend subsystem that extracts musical features from audio in the browser using Meyda.js (RMS, spectral features) and Essentia.js (BPM, key, chords via WASM).
- **Graph_Renderer**: The Frontend subsystem built on p5.js that draws animated graphical elements on a canvas.
- **Stem_Renderer**: A per-stem component owned by the Graph_Renderer that subscribes to the Timeline_Stream for one stem and runs its own animation loop.
- **Timeline_Stream**: The shared, normalized data stream of timeline points consumed by the Graph_Renderer.
- **Timeline_Point**: A single normalized data element of the form `{ t: number, value: number, stem: Stem_Type }`, where `t` is time in seconds and `value` is the stem's measured value at that time.
- **Stem_Type**: One of the enumerated stem identifiers: `drums`, `melody`, `bass`, `vocals`, `chords`.
- **Stem**: A separated or derived audio component corresponding to a Stem_Type.
- **Graph_Style**: A selectable visual representation for a stem (for example, bouncing balls or a parametric curve for drums).
- **Coordinate_System**: The configurable mapping of data values to canvas coordinates, with an x range of `[0, song_duration]` and a y range of `[-1, 1]` normalized, optionally mapped to musical units (Hz, MIDI note number, dB).
- **UI_Overlay**: The React layer of interactive controls rendered above the p5.js canvas.
- **Playback_Controls**: The UI_Overlay elements that control play, pause, and seek of the Audio_Engine.
- **Stem_Toggle**: A UI_Overlay control that enables or disables rendering of a single stem.
- **Supported_Audio_Format**: An audio file encoded as MP3 or WAV.

## Requirements

### Requirement 1: Audio File Upload

**User Story:** As a listener, I want to upload an audio file, so that I can visualize a song of my choosing.

#### Acceptance Criteria

1. WHEN a user submits a file in a Supported_Audio_Format whose size is greater than zero bytes and within the configured maximum upload size, THE Frontend SHALL load the file into the Audio_Engine for playback.
2. IF a user submits a file that is not a Supported_Audio_Format, THEN THE Frontend SHALL reject the file and display a message identifying the accepted formats as MP3 and WAV.
3. IF a user submits a file whose size exceeds the configured maximum upload size of 100 MB (104,857,600 bytes), THEN THE Frontend SHALL reject the file and display a message stating the maximum allowed size.
4. IF a user submits a file whose size is zero bytes, THEN THE Frontend SHALL reject the file, not load it into the Audio_Engine, and display a message stating the file is empty.
5. IF a user submits a file with a Supported_Audio_Format extension whose contents cannot be decoded as valid audio, THEN THE Frontend SHALL reject the file, not load it into the Audio_Engine, and display a message reporting that the file could not be decoded.
6. WHEN an audio file is successfully loaded, THE Audio_Engine SHALL determine the song duration in seconds as a value greater than zero.

### Requirement 2: Audio Playback Control

**User Story:** As a listener, I want to control playback, so that I can navigate through the song while watching the graph.

#### Acceptance Criteria

1. WHEN a user activates the play control AND an audio file is loaded into the Audio_Engine, THE Audio_Engine SHALL begin audio playback from the current playback position, where the current playback position defaults to 0 seconds when no prior seek or playback has occurred.
2. WHEN a user activates the pause control, THE Audio_Engine SHALL suspend audio playback and retain the current playback position.
3. WHEN a user sets the playback position using the seek control to a time within the range `[0, song_duration]`, THE Audio_Engine SHALL set the current playback position to the selected time.
4. WHILE audio is playing, THE Audio_Engine SHALL expose the current playback time in seconds to the Graph_Renderer, updated at least 30 times per second.
5. IF a user sets the playback position using the seek control to a time outside the range `[0, song_duration]`, THEN THE Audio_Engine SHALL clamp the current playback position to the nearest boundary of the range `[0, song_duration]`.
6. IF a user activates the play control when no audio file is loaded into the Audio_Engine, THEN THE Audio_Engine SHALL not begin playback and THE Frontend SHALL display a message indicating that no audio file is loaded.
7. WHEN audio playback reaches `song_duration`, THE Audio_Engine SHALL suspend playback and retain the current playback position at `song_duration`.

### Requirement 3: In-Browser Audio Analysis

**User Story:** As a listener, I want the app to analyze audio in my browser, so that I can see a graph without waiting for a server when stem separation is not required.

#### Acceptance Criteria

1. WHEN an audio file is loaded, THE Analysis_Engine SHALL extract per-frame RMS values using Meyda.js.
2. WHEN an audio file is loaded, THE Analysis_Engine SHALL extract spectral envelope features used to derive drum onsets using Meyda.js.
3. WHEN an audio file is loaded, THE Analysis_Engine SHALL estimate the song tempo in beats per minute, the musical key, and the melody pitch using Essentia.js.
4. WHEN the Analysis_Engine extracts a feature for a given time, THE Analysis_Engine SHALL emit a Timeline_Point onto the Timeline_Stream with a `t` within `[0, song_duration]`, a `value` normalized to `[-1, 1]`, and a `stem` set to a Stem_Type.
5. IF the Analysis_Engine cannot complete analysis for a loaded file, including not completing within the configured maximum analysis duration, THEN THE Frontend SHALL display a message reporting that analysis failed.
6. IF the Analysis_Engine completes some features but fails to extract one or more other features, THEN THE Frontend SHALL display a message identifying which features failed to extract.
7. WHILE the Analysis_Engine fails to extract one or more features, THE Analysis_Engine SHALL continue to emit Timeline_Points for the features it successfully extracts.
8. IF the Analysis_Engine fails for a loaded file, THEN THE Audio_Engine SHALL retain the loaded file and keep it playable.

### Requirement 4: Stem Separation Service

**User Story:** As a listener, I want the song separated into individual stems, so that each musical component can be visualized independently.

#### Acceptance Criteria

1. WHEN the Frontend sends a Supported_Audio_Format file to the Demucs_Service stem separation endpoint, THE Demucs_Service SHALL return four separated stem audio files, each encoded in a Supported_Audio_Format, corresponding to drums, bass, vocals, and other.
2. IF the Demucs_Service receives a request whose body is not a Supported_Audio_Format file, THEN THE Demucs_Service SHALL respond with a client error status, return no stem files, and indicate the accepted formats in the response body.
3. IF the Demucs_Service receives a file whose size exceeds the configured maximum stem separation file size, THEN THE Demucs_Service SHALL respond with a client error status, return no stem files, and state the maximum allowed size in the response body.
4. IF stem separation fails during processing, THEN THE Demucs_Service SHALL respond with a server error status, return no stem files, and indicate that separation failed in the response body.
5. IF stem separation does not complete within the configured maximum processing time, THEN THE Demucs_Service SHALL respond with a server error status, return no stem files, and indicate that processing timed out in the response body.
6. IF the Demucs_Service encounters a server error other than separation failure, including service unavailability or resource exhaustion, THEN THE Demucs_Service SHALL respond with a server error status, return no stem files, and indicate the nature of the failure in the response body.
7. THE Demucs_Service SHALL be deployable independently of the Frontend.
8. WHEN the Demucs_Service returns separated stems, THE Frontend SHALL run an Analysis_Engine pass on each returned stem.
9. WHEN the Demucs_Service returns separated stems, THE Frontend SHALL map the Demucs_Service `other` stem to the melody Stem_Type.
10. THE Analysis_Engine SHALL derive the chords Stem_Type exclusively from harmonic analysis rather than from stem separation.

### Requirement 5: Stem-Aware Graph Rendering

**User Story:** As a listener, I want each stem rendered as its own animated graph, so that I can see how each musical component behaves over time.

#### Acceptance Criteria

1. WHILE audio is playing, THE Graph_Renderer SHALL set the graph horizontal position so that the rendered x-axis position corresponds to the current playback time reported by the Audio_Engine within a tolerance of 100 milliseconds.
2. WHERE the drums Stem_Renderer is active, THE Graph_Renderer SHALL render one or more ball elements whose vertical position moves downward over time under a constant downward acceleration.
3. WHERE the melody Stem_Renderer is active, THE Graph_Renderer SHALL render a continuous parametric curve whose vertical value represents melody pitch frequency.
4. WHERE the bass Stem_Renderer is active, THE Graph_Renderer SHALL render a sine wave whose amplitude represents the low-frequency band energy.
5. WHERE the vocals Stem_Renderer is active, THE Graph_Renderer SHALL render an RMS envelope that increases in vertical value as vocal presence increases.
6. WHERE the chords Stem_Renderer is active, THE Graph_Renderer SHALL render stacked translucent curves representing the chord segments over time.
7. WHEN a Stem_Renderer receives a Timeline_Point for its stem, THE Stem_Renderer SHALL update its animation using that Timeline_Point.
8. WHILE audio is paused, THE Graph_Renderer SHALL hold the graph horizontal position at the retained playback time reported by the Audio_Engine.
9. WHERE the drums Stem_Renderer is active, WHEN a kick onset is detected, THE Graph_Renderer SHALL reset the vertical position of each rendered ball element to the top of the y-axis range.
10. IF a Stem_Renderer has received no Timeline_Point for its stem, THEN THE Graph_Renderer SHALL render no graphical element for that stem.

### Requirement 6: Stem Toggle Control

**User Story:** As a listener, I want to toggle stems on and off, so that I can focus on specific musical components.

#### Acceptance Criteria

1. WHEN a user disables a Stem_Toggle for a stem, THE Graph_Renderer SHALL stop rendering that stem's graphical element within 100 milliseconds while continuing to render every other enabled stem's graphical element unchanged.
2. WHEN a user enables a Stem_Toggle for a stem that has Timeline_Points available on the Timeline_Stream, THE Graph_Renderer SHALL resume rendering that stem's graphical element within 100 milliseconds while continuing to render every other enabled stem's graphical element unchanged.
3. THE UI_Overlay SHALL present exactly one Stem_Toggle for each of the five Stem_Type values regardless of whether a corresponding Stem has been separated or analyzed.
4. WHEN an audio file is loaded, THE UI_Overlay SHALL initialize every Stem_Toggle to the enabled state.
5. IF a user enables a Stem_Toggle for a stem that has no Timeline_Points available on the Timeline_Stream, THEN THE Graph_Renderer SHALL render no graphical element for that stem until Timeline_Points for that stem become available.

### Requirement 7: Per-Stem Graph Style Selection

**User Story:** As a listener, I want to switch the visual representation for each stem, so that I can choose the view that communicates the music best to me.

#### Acceptance Criteria

1. THE UI_Overlay SHALL present a Graph_Style picker for each Stem_Type that has at least one defined Graph_Style.
2. WHEN a user selects an available Graph_Style for a stem, THE Stem_Renderer for that stem SHALL render the next frame and all subsequent frames using the selected Graph_Style.
3. WHERE a stem has more than one defined Graph_Style, THE UI_Overlay SHALL list every Graph_Style defined for that stem, including styles whose required analysis data has not yet been produced for that stem.
4. IF a Graph_Style for a stem has required analysis data that has not yet been produced, THEN THE UI_Overlay SHALL display that Graph_Style as disabled and SHALL NOT allow it to be selected.
5. WHILE a user has not selected a Graph_Style for a stem, THE Stem_Renderer for that stem SHALL render using the default Graph_Style defined for that stem.
6. THE Harmograph_App SHALL define exactly one default Graph_Style per Stem_Type for the MVP as specified in the Default Graph Styles table, deferring additional Graph_Styles to a later release.

#### Default Graph Styles

| Stem_Type | Default Graph_Style |
| --- | --- |
| drums | bouncing balls |
| melody | continuous parametric curve |
| bass | sine wave |
| vocals | RMS amplitude envelope |
| chords | stacked translucent curves |

### Requirement 8: Tempo and Key Readout

**User Story:** As a listener, I want to see the song's tempo and key, so that I can understand its musical context.

#### Acceptance Criteria

1. WHEN the Analysis_Engine estimates a tempo within the configured plausible tempo range of 40 to 250 beats per minute, THE UI_Overlay SHALL display the tempo rounded to the nearest integer beats per minute.
2. IF the estimated tempo falls outside the configured plausible tempo range of 40 to 250 beats per minute, THEN THE UI_Overlay SHALL display a placeholder indicating the tempo could not be determined instead of the implausible value.
3. WHEN the Analysis_Engine estimates the key, THE UI_Overlay SHALL display the musical key as a tonic pitch class (one of the twelve chromatic pitch classes) and a mode of either major or minor.
4. IF the Analysis_Engine cannot determine the musical key, THEN THE UI_Overlay SHALL display a placeholder indicating the key could not be determined instead of a key value, while retaining any separately displayed tempo value.
5. WHILE the tempo and key estimates are pending, THE UI_Overlay SHALL display a pending indicator for the tempo and key readout.

### Requirement 9: Configurable Coordinate System

**User Story:** As a listener, I want the graph axes mapped to meaningful ranges, so that the values I see correspond to the music.

#### Acceptance Criteria

1. THE Coordinate_System SHALL map the x-axis to the range `[0, song_duration]` in seconds.
2. IF the song duration is zero or less than 1 second, THEN THE Coordinate_System SHALL map the x-axis to the range `[0, 1]` in seconds.
3. THE Coordinate_System SHALL map the y-axis to the normalized range `[-1, 1]` by default.
4. WHERE a user selects a musical unit mapping for the y-axis, THE Coordinate_System SHALL map the y-axis to the selected unit using the range `[20, 20000]` for Hz, `[0, 127]` for MIDI note number, and `[-60, 0]` for dB.
5. IF a data value falls outside the active y-axis range, THEN THE Coordinate_System SHALL clamp the value to the nearest y-axis bound before mapping it to a canvas coordinate.
6. WHEN the Coordinate_System mapping changes, THE Graph_Renderer SHALL render the next frame and all subsequent frames using the updated mapping.

### Requirement 10: Normalized Timeline Data Model

**User Story:** As a developer, I want all analysis output normalized to a shared timeline format, so that renderers can consume any stem through one consistent interface.

#### Acceptance Criteria

1. THE Analysis_Engine SHALL represent each emitted data element as a Timeline_Point containing a `t` field expressed in seconds within the range `[0, song_duration]`, a `value` field normalized to the range `[-1, 1]`, and a `stem` field.
2. THE Analysis_Engine SHALL assign the `stem` field of each Timeline_Point to exactly one Stem_Type among `drums`, `melody`, `bass`, `vocals`, and `chords`.
3. WHEN a Stem_Renderer subscribes to the Timeline_Stream for a given Stem_Type, THE Timeline_Stream SHALL deliver to that Stem_Renderer only the Timeline_Points whose `stem` field equals that Stem_Type.
4. IF the Analysis_Engine produces a data element that is missing its `t`, `value`, or `stem` field, or whose `stem` field is not one of the enumerated Stem_Types, or whose `t` or `value` falls outside its defined range, THEN THE Analysis_Engine SHALL exclude that element from the Timeline_Stream and retain the previously emitted Timeline_Points.
5. WHEN the Timeline_Stream delivers Timeline_Points to a Stem_Renderer, THE Timeline_Stream SHALL deliver them in non-decreasing order of their `t` field.

### Requirement 11: UI Overlay and Canvas Interaction

**User Story:** As a listener, I want the controls to sit above the graph without interfering with it, so that I can operate the app smoothly.

#### Acceptance Criteria

1. THE UI_Overlay SHALL render in a display layer with a higher stacking order than the p5.js canvas, such that its controls remain fully visible and operable over all canvas content regardless of what the Graph_Renderer draws.
2. WHEN a user generates a pointer, mouse, touch, or keyboard event on an interactive control within the UI_Overlay, THE UI_Overlay SHALL handle the event and SHALL NOT forward that event to the p5.js canvas.
3. WHEN a user generates a pointer, mouse, or touch event on a region of the UI_Overlay that contains no interactive control, THE UI_Overlay SHALL forward that event to the p5.js canvas.

### Requirement 12: Independent Deployability and Processing Locality

**User Story:** As an operator, I want the frontend and the stem separation backend to deploy and scale independently, so that I can host them on different platforms.

#### Acceptance Criteria

1. THE Frontend SHALL be packaged as a deployment artifact separate from the Demucs_Service such that deploying or restarting the Frontend does not require deploying or restarting the Demucs_Service.
2. THE Demucs_Service SHALL be packaged as a deployment artifact separate from the Frontend such that deploying or restarting the Demucs_Service does not require deploying or restarting the Frontend.
3. THE Frontend SHALL reach the Demucs_Service through a configurable network endpoint so that the two components can be hosted on different platforms.
4. WHERE an audio processing task other than stem separation can be completed in the browser, THE Frontend SHALL perform that task in the browser rather than sending data to the Demucs_Service.
5. THE Frontend SHALL send audio data to the Demucs_Service only for stem separation requests.
6. IF the Demucs_Service is unreachable when the Frontend attempts a stem separation request, THEN THE Frontend SHALL display a message reporting that stem separation is unavailable and SHALL retain the loaded file and its in-browser analysis.
7. WHERE the Frontend needs to perform non-audio operations such as health checks or metadata retrieval, THE Frontend MAY send requests to the Demucs_Service that do not contain audio data.
