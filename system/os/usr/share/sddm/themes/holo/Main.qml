/***************************************************************************
* Copyright (c) 2013 Abdurrahman AVCI <abdurrahmanavci@gmail.com>
* MIT — see the upstream SDDM maldives theme (installed verbatim alongside).
*
* The Hologram greeter — the FORM only (prompt · Name · Access). The brand mark,
* the glass card, and the secondary doors are the page's CSS chrome (login.html),
* tuned to the holo-pulse boot splash; this QML stays the real SDDM object tree
* that Holo QML executes. Authentication is the unchanged self-sovereign unlock.
***************************************************************************/

import QtQuick 2.0
import SddmComponents 2.0

Rectangle {
    id: container
    width: 280
    height: form.implicitHeight
    color: "transparent"

    property bool asking: false
    function reveal() {
        container.asking = true
        errorMessage.color = "#7defc9"
        errorMessage.text = "Enter your name"
        name.focus = true
        if (sddm.refresh) sddm.refresh()
    }
    function start() {
        if (userModel.count > 0) sddm.unlockDevice()
        else container.reveal()
    }

    TextConstants { id: textConstants }

    Connections {
        target: sddm
        function onLoginSucceeded() { errorMessage.color = "#7defc9"; errorMessage.text = textConstants.loginSucceeded }
        function onLoginFailed() { errorMessage.color = "#fca5a5"; errorMessage.text = textConstants.loginFailed }
        function onInformationMessage(message) { errorMessage.color = "#9fb3c8"; errorMessage.text = message }
        function onNeedName() { container.reveal() }
    }

    Column {
        id: form
        width: parent.width
        spacing: 21                                  // Fibonacci rhythm

        Text {
            id: errorMessage
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: userModel.count > 0 ? ("Welcome back, " + userModel.lastUser) : "Your sovereign key"
            color: "#9fb3c8"
            wrapMode: Text.WordWrap
            font.pixelSize: 13
        }

        // Name — revealed only on the first Access (first run / enrol)
        Column {
            width: parent.width
            visible: container.asking
            TextBox {
                id: name
                width: parent.width; height: 44
                text: userModel.lastUser
                font.pixelSize: 15
                KeyNavigation.backtab: accessButton; KeyNavigation.tab: accessButton
                Keys.onPressed: function (event) {
                    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { sddm.access(name.text); event.accepted = true }
                }
            }
        }

        Button {
            id: accessButton
            width: parent.width
            text: textConstants.access
            onClicked: container.asking ? sddm.access(name.text) : container.start()
            KeyNavigation.backtab: name; KeyNavigation.tab: name
        }
    }

    Component.onCompleted: { accessButton.focus = true }
}
