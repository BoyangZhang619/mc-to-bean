@rem
@rem Gradle 启动脚本 — 用于 Windows 系统
@rem 自动下载并使用 gradle-wrapper.properties 中指定的 Gradle 版本
@rem

@if "%DEBUG%"=="" @echo off
@rem ##########################################################################
@rem
@rem  Gradle startup script for Windows
@rem
@rem ##########################################################################

@rem Set local scope for the variables with windows NT shell
if "%OS%"=="Windows_NT" setlocal

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
@rem This is normally unused
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

@rem Resolve any "." and ".." in APP_HOME to make it shorter.
for %%i in ("%APP_HOME%") do set APP_HOME=%%~fi

set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar

@rem Execute Gradle
if "%JAVA_HOME%"=="" (
    set JAVACMD=java
) else (
    set JAVACMD=%JAVA_HOME%\bin\java.exe
)

if not exist "%JAVACMD%" (
    echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
    echo Please set the JAVA_HOME variable in your environment to match the
    echo location of your Java installation.
    exit /b 1
)

set DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"

@rem Find java.exe
set JAVA_EXE=%JAVACMD:"=%
set JAVA_OPTS=%JAVA_OPTS% %DEFAULT_JVM_OPTS%

"%JAVA_EXE%" %JAVA_OPTS% -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*

@rem End local scope for the variables with windows NT shell
if "%OS%"=="Windows_NT" endlocal

:omega
