/***************************************************************************
* Copyright (c) 2013 Abdurrahman AVCI <abdurrahmanavci@gmail.com>
*
* Permission is hereby granted, free of charge, to any person
* obtaining a copy of this software and associated documentation
* files (the "Software"), to deal in the Software without restriction,
* including without limitation the rights to use, copy, modify, merge,
* publish, distribute, sublicense, and/or sell copies of the Software,
* and to permit persons to whom the Software is furnished to do so,
* subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included
* in all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
* OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
* THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
* OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
* ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
* OR OTHER DEALINGS IN THE SOFTWARE.
*
***************************************************************************/

import QtQuick 2.0
import SddmComponents 2.0

Rectangle {
    id: container
    width: 640
    height: 480

    LayoutMirroring.enabled: Qt.locale().textDirection == Qt.RightToLeft
    LayoutMirroring.childrenInherit: true

    // Two-step sign-in: the card shows only Access first; the first click reveals the Name field.
    property bool asking: false
    function reveal() {
        container.asking = true
        errorMessage.color = "black"
        errorMessage.text = "Enter your name"
        name.focus = true
        if (sddm.refresh) sddm.refresh()           // re-measure so the card grows to fit the field
    }
    // First Access press: a known device unlocks by biometric with no name (Law L1); an empty
    // device reveals the Name field to enrol a new sovereign identity.
    function start() {
        if (userModel.count > 0) sddm.unlockDevice()
        else container.reveal()
    }

    TextConstants { id: textConstants }

    Connections {
        target: sddm

        function onLoginSucceeded() {
            errorMessage.color = "steelblue"
            errorMessage.text = textConstants.loginSucceeded
        }
        function onLoginFailed() {
            errorMessage.color = "red"
            errorMessage.text = textConstants.loginFailed
        }
        function onInformationMessage(message) {
            errorMessage.color = "steelblue"
            errorMessage.text = message
        }
        // No identity on this device (or no biometric) → reveal the Name field to enrol.
        function onNeedName() {
            container.reveal()
        }
    }

    Background {
        anchors.fill: parent
        source: Qt.resolvedUrl(config.background)
        fillMode: Image.PreserveAspectCrop
        onStatusChanged: {
            var defaultBackground = Qt.resolvedUrl(config.defaultBackground)
            if (status == Image.Error && source != defaultBackground) {
                source = defaultBackground
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "transparent"
        //visible: primaryScreen

        Image {
            id: rectangle
            anchors.centerIn: parent
            width: Math.max(320, mainColumn.implicitWidth + 50)
            height: Math.max(320, mainColumn.implicitHeight + 50)

            source: Qt.resolvedUrl("rectangle.png")

            Column {
                id: mainColumn
                anchors.centerIn: parent
                spacing: 12
                Column {
                    width: parent.width
                    Text {
                        id: errorMessage
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        // A returning device already knows its operator (Law L3) — greet, don't ask.
                        text: userModel.count > 0 ? ("Welcome back, " + userModel.lastUser) : textConstants.prompt
                        wrapMode: Text.WordWrap
                        font.pixelSize: 13
                    }
                }

                Column {
                    width: parent.width
                    spacing: 4
                    visible: container.asking
                    Text {
                        id: lblName
                        width: parent.width
                        text: "Name"
                        font.bold: true
                        font.pixelSize: 12
                    }

                    TextBox {
                        id: name
                        width: parent.width; height: 30
                        text: userModel.lastUser
                        font.pixelSize: 14

                        KeyNavigation.backtab: accessButton; KeyNavigation.tab: accessButton

                        Keys.onPressed: function (event) {
                            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                                sddm.access(name.text)
                                event.accepted = true
                            }
                        }
                    }
                }

                Row {
                    anchors.horizontalCenter: parent.horizontalCenter

                    Button {
                        id: accessButton
                        text: textConstants.access
                        width: Math.max(accessButton.implicitWidth, 120)

                        // asking → submit the typed name. Otherwise container.start() decides:
                        // biometric unlock on a known device, or reveal the Name field to enrol.
                        onClicked: container.asking ? sddm.access(name.text) : container.start()

                        KeyNavigation.backtab: name; KeyNavigation.tab: name
                    }
                }

                Column {
                    width: parent.width
                    visible: userModel.count > 0 && !container.asking
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "Use another identity"
                        color: "#266294"
                        font.pixelSize: 11
                        onClicked: container.reveal()
                    }
                }
            }
        }
    }

    Component.onCompleted: {
        accessButton.focus = true
    }
}
